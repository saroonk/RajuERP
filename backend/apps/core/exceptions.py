"""One error format for the whole API: {"message": "...", "errors": {field: [messages]}} (camelCased on output)."""

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError
from django.db.models import ProtectedError
from django.http import Http404
from rest_framework import status
from rest_framework.exceptions import APIException, ValidationError
from rest_framework.response import Response
from rest_framework.views import exception_handler


class DomainError(Exception):
    """A business rule was violated (insufficient stock, over-allocation, ...). Becomes HTTP 400."""

    def __init__(self, message: str, errors: dict | None = None):
        super().__init__(message)
        self.message = message
        self.errors = errors or {}


class ConflictError(DomainError):
    """The request conflicts with current state (record in use, already invoiced, ...). Becomes HTTP 409."""


def _first_message(data) -> str:
    if isinstance(data, dict):
        for key, value in data.items():
            msg = _first_message(value)
            if msg:
                return msg if key in ("detail", "non_field_errors") else f"{key}: {msg}"
        return ""
    if isinstance(data, (list, tuple)):
        for item in data:
            msg = _first_message(item)
            if msg:
                return msg
        return ""
    return str(data)


def api_exception_handler(exc, context):
    if isinstance(exc, ConflictError):
        return Response({"message": exc.message, "errors": exc.errors}, status=status.HTTP_409_CONFLICT)
    if isinstance(exc, DomainError):
        return Response({"message": exc.message, "errors": exc.errors}, status=status.HTTP_400_BAD_REQUEST)
    if isinstance(exc, DjangoValidationError):
        exc = ValidationError(detail=exc.message_dict if hasattr(exc, "error_dict") else exc.messages)
    if isinstance(exc, ProtectedError):
        return Response(
            {"message": "This record is used by other records and cannot be deleted. Mark it inactive instead.", "errors": {}},
            status=status.HTTP_409_CONFLICT,
        )
    if isinstance(exc, IntegrityError):
        return Response(
            {"message": "This change conflicts with existing data (duplicate or in use).", "errors": {}},
            status=status.HTTP_409_CONFLICT,
        )
    if isinstance(exc, Http404):
        return Response({"message": "Not found.", "errors": {}}, status=status.HTTP_404_NOT_FOUND)

    response = exception_handler(exc, context)
    if response is None:
        return None  # unexpected errors become a generic 500 (no stack trace is returned when DEBUG is off)
    data = response.data
    if isinstance(exc, ValidationError):
        errors = data if isinstance(data, dict) else {"non_field_errors": data}
        response.data = {"message": _first_message(data) or "Invalid data.", "errors": errors}
    elif isinstance(exc, APIException):
        response.data = {"message": _first_message(data) or "Request failed.", "errors": {}}
    return response
