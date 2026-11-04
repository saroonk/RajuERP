from rest_framework.permissions import SAFE_METHODS, BasePermission


def role_level(user, module: str) -> str:
    """'none' | 'view' | 'edit' for the user's role in a module (the permission matrix decides, admins included)."""
    from apps.users.models import RolePermission

    if not user.is_authenticated or not user.is_active:
        return "none"
    cache = getattr(user, "_perm_cache", None)
    if cache is None:
        cache = {p.module: p.level for p in RolePermission.objects.filter(role=user.role)}
        user._perm_cache = cache
    return cache.get(module, "none")


def has_module_level(user, module: str, level: str) -> bool:
    granted = role_level(user, module)
    return granted == "edit" or (level == "view" and granted == "view")


class ModulePermission(BasePermission):
    """
    Server-side authorization (the frontend only mirrors it for usability).

    A view declares `permission_module` (or `permission_modules = {action: module}`). Safe methods need
    'view' on that module, everything else needs 'edit'. Views that set `permission_module = None` need
    only an authenticated user (shared lookups). A view with no declaration at all is denied.
    """

    message = "You do not have permission to perform this action."

    def has_permission(self, request, view):
        user = request.user
        if not user or not user.is_authenticated:
            return False
        modules = getattr(view, "permission_modules", None) or {}
        action = getattr(view, "action", None)
        if action in modules:
            module = modules[action]
        elif hasattr(view, "permission_module"):
            module = view.permission_module
        else:
            return False
        if module is None:
            return True
        level = "view" if request.method in SAFE_METHODS else "edit"
        return has_module_level(user, module, level)
