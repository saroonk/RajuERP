from django.contrib.auth import authenticate, login, logout
from django.middleware.csrf import get_token
from django.utils import timezone
from django.views.decorators.csrf import ensure_csrf_cookie
from django.utils.decorators import method_decorator
from rest_framework import status, viewsets
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from apps.core.audit import audit
from apps.core.exceptions import ConflictError, DomainError

from .models import MODULES, ROLES, RolePermission, User
from .permissions import ensure_default_permissions
from .serializers import LoginSerializer, PermissionUpdateSerializer, UserSerializer


@method_decorator(ensure_csrf_cookie, name="dispatch")
class CsrfView(APIView):
    """Sets the CSRF cookie; the SPA calls this once before its first unsafe request."""

    permission_classes = [AllowAny]
    authentication_classes: list = []

    def get(self, request):
        return Response({"csrfToken": get_token(request)})


class LoginView(APIView):
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "login"

    def post(self, request):
        s = LoginSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        user = authenticate(request, username=s.validated_data["email"].lower(), password=s.validated_data["password"])
        # Same message for unknown email, wrong password and inactive account: no account enumeration.
        if user is None or not user.is_active:
            return Response({"message": "Invalid email or password.", "errors": {}}, status=status.HTTP_401_UNAUTHORIZED)
        login(request, user)
        user.last_login = timezone.now()
        user.save(update_fields=["last_login"])
        audit(user, "login", "User", user.name, f"{user.name} signed in")
        return Response(UserSerializer(user).data)


class LogoutView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        if request.user.is_authenticated:
            audit(request.user, "login", "User", request.user.name, f"{request.user.name} signed out")
        logout(request)
        return Response(status=status.HTTP_204_NO_CONTENT)


class MeView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        if not request.user.is_authenticated:
            return Response({"message": "Not authenticated.", "errors": {}}, status=status.HTTP_401_UNAUTHORIZED)
        return Response(UserSerializer(request.user).data)


class UserViewSet(viewsets.ModelViewSet):
    permission_module = "admin"
    serializer_class = UserSerializer
    queryset = User.objects.all()
    search_fields = ["name", "email"]
    filterset_fields = ["role", "is_active"]
    ordering_fields = ["name", "email", "role", "last_login"]
    ordering = ["name"]

    def perform_create(self, serializer):
        user = serializer.save()
        audit(self.request.user, "create", "User", user.name, f"Added user {user.name} ({user.role})")

    def perform_update(self, serializer):
        instance = serializer.instance
        new_role = serializer.validated_data.get("role", instance.role)
        new_active = serializer.validated_data.get("is_active", instance.is_active)
        if instance.role == "admin" and not (new_role == "admin" and new_active) and not self._other_admins(instance):
            raise DomainError("At least one active administrator is required.")
        user = serializer.save()
        audit(self.request.user, "update", "User", user.name, f"Updated user {user.name}")

    def perform_destroy(self, instance):
        if instance.pk == self.request.user.pk:
            raise DomainError("You cannot delete the account you are signed in with.")
        if instance.role == "admin" and not self._other_admins(instance):
            raise DomainError("At least one active administrator is required.")
        name = instance.name
        instance.delete()
        audit(self.request.user, "delete", "User", name, f"Deleted user {name}")

    @staticmethod
    def _other_admins(instance) -> bool:
        return User.objects.filter(role="admin", is_active=True).exclude(pk=instance.pk).exists()


def _matrix() -> dict:
    ensure_default_permissions()
    out: dict = {role: {} for role, _ in ROLES}
    for p in RolePermission.objects.all():
        out[p.role][p.module] = p.level
    return out


class PermissionMatrixView(APIView):
    """GET: the role/module matrix (any signed-in user: the SPA needs its own role's row). PUT: administrators only."""

    permission_module = None

    def get(self, request):
        return Response(_matrix())

    def put(self, request):
        from apps.core.permissions import has_module_level

        if not has_module_level(request.user, "admin", "edit"):
            return Response({"message": "You do not have permission to perform this action.", "errors": {}}, status=status.HTTP_403_FORBIDDEN)
        s = PermissionUpdateSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        role, module, level = s.validated_data["role"], s.validated_data["module"], s.validated_data["level"]
        if role == "admin" and module == "admin" and level != "edit":
            raise ConflictError("Administrators must keep full access to Administration.")
        ensure_default_permissions()
        RolePermission.objects.filter(role=role, module=module).update(level=level)
        audit(request.user, "update", "Permissions", role, f"Set {role} access to {module}: {level}")
        return Response(_matrix())
