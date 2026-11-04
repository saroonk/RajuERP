"""Default role -> module permission matrix. Administrators can change it later via the API."""

from .models import MODULES, ROLES

_VIEW = "view"
_EDIT = "edit"

DEFAULT_MATRIX: dict[str, dict[str, str]] = {
    "admin": {m: _EDIT for m in MODULES},
    "accounts": {
        **{m: "none" for m in MODULES},
        **{m: _VIEW for m in ["dashboard", "products", "inventory", "purchases", "distributors", "distribution", "reports"]},
        **{m: _EDIT for m in ["sales", "receivables", "payables", "expenses"]},
    },
    "warehouse": {
        **{m: "none" for m in MODULES},
        **{m: _VIEW for m in ["dashboard", "products", "distributors", "sales", "reports"]},
        **{m: _EDIT for m in ["inventory", "purchases", "distribution"]},
    },
    "sales": {
        **{m: "none" for m in MODULES},
        **{m: _VIEW for m in ["dashboard", "products", "inventory", "receivables", "reports"]},
        **{m: _EDIT for m in ["distributors", "distribution", "sales"]},
    },
}


def ensure_default_permissions(**_kwargs) -> None:
    """Creates any missing role/module rows with the defaults; never overwrites an administrator's changes."""
    from .models import RolePermission

    existing = set(RolePermission.objects.values_list("role", "module"))
    missing = [
        RolePermission(role=role, module=module, level=DEFAULT_MATRIX[role][module])
        for role, _label in ROLES
        for module in MODULES
        if (role, module) not in existing
    ]
    if missing:
        RolePermission.objects.bulk_create(missing)
