from django.contrib.auth.base_user import AbstractBaseUser, BaseUserManager
from django.contrib.auth.models import PermissionsMixin
from django.db import models
from django.utils import timezone

ROLES = [("admin", "Administrator"), ("accounts", "Accounts"), ("warehouse", "Warehouse"), ("sales", "Sales")]

MODULES = [
    "dashboard",
    "products",
    "inventory",
    "purchases",
    "distributors",
    "distribution",
    "sales",
    "receivables",
    "payables",
    "expenses",
    "reports",
    "admin",
]
LEVELS = [("none", "none"), ("view", "view"), ("edit", "edit")]


class UserManager(BaseUserManager):
    use_in_migrations = True

    def create_user(self, email, password=None, **extra):
        if not email:
            raise ValueError("Email is required")
        user = self.model(email=self.normalize_email(email).lower(), **extra)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_superuser(self, email, password=None, **extra):
        extra.setdefault("role", "admin")
        extra.setdefault("name", "Administrator")
        return self.create_user(email, password, **extra)


class User(AbstractBaseUser, PermissionsMixin):
    email = models.EmailField(unique=True)
    name = models.CharField(max_length=150)
    role = models.CharField(max_length=12, choices=ROLES, default="sales")
    is_active = models.BooleanField(default=True)
    date_joined = models.DateTimeField(default=timezone.now)

    objects = UserManager()
    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = ["name"]

    @property
    def is_staff(self) -> bool:  # Django admin access follows the application role
        return self.is_active and self.role == "admin"

    def __str__(self) -> str:
        return f"{self.name} <{self.email}>"


class RolePermission(models.Model):
    """What a role may do in a module. Editable by administrators; enforced by the API."""

    role = models.CharField(max_length=12, choices=ROLES)
    module = models.CharField(max_length=20, choices=[(m, m) for m in MODULES])
    level = models.CharField(max_length=5, choices=LEVELS, default="none")

    class Meta:
        constraints = [models.UniqueConstraint(fields=["role", "module"], name="uniq_role_module")]
