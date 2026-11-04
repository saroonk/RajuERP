from django.apps import AppConfig
from django.db.models.signals import post_migrate


class UsersConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.users"

    def ready(self):
        from .permissions import ensure_default_permissions

        post_migrate.connect(ensure_default_permissions, sender=self)
