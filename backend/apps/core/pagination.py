from rest_framework.pagination import PageNumberPagination


class StandardPagination(PageNumberPagination):
    page_size = 50
    page_size_query_param = "page_size"
    max_page_size = 1000


def paginated(view, request, rows, serializer_class=None):
    """Paginates a plain Python list (computed rows) using the same response format as querysets."""
    paginator = StandardPagination()
    page = paginator.paginate_queryset(rows, request, view=view)
    if serializer_class:
        page = serializer_class(page, many=True, context={"request": request}).data
    return paginator.get_paginated_response(page)
