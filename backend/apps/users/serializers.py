from django.contrib.auth.password_validation import validate_password
from rest_framework import serializers

from .models import MODULES, ROLES, LEVELS, User


class UserSerializer(serializers.ModelSerializer):
    """Frontend shape: {id, name, email, role, active, lastLogin}. `password` is write-only and optional on update."""

    id = serializers.CharField(read_only=True)
    active = serializers.BooleanField(source="is_active", required=False, default=True)
    last_login = serializers.DateTimeField(read_only=True)
    password = serializers.CharField(write_only=True, required=False, allow_blank=False, trim_whitespace=False)

    class Meta:
        model = User
        fields = ["id", "name", "email", "role", "active", "last_login", "password"]

    def validate_email(self, value):
        value = value.lower()
        qs = User.objects.filter(email__iexact=value)
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError(f"A user with email {value} already exists.")
        return value

    def validate_password(self, value):
        validate_password(value, user=self.instance)
        return value

    def validate(self, attrs):
        if not self.instance and "password" not in attrs:
            raise serializers.ValidationError({"password": "A password is required for a new user."})
        return attrs

    def create(self, validated):
        password = validated.pop("password")
        return User.objects.create_user(password=password, **validated)

    def update(self, instance, validated):
        password = validated.pop("password", None)
        for k, v in validated.items():
            setattr(instance, k, v)
        if password:
            instance.set_password(password)
        instance.save()
        return instance


class LoginSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField(trim_whitespace=False)


class PermissionUpdateSerializer(serializers.Serializer):
    role = serializers.ChoiceField(choices=[r for r, _ in ROLES])
    module = serializers.ChoiceField(choices=MODULES)
    level = serializers.ChoiceField(choices=[l for l, _ in LEVELS])
