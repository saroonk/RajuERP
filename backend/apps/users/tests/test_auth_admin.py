from rest_framework.test import APIClient

from apps.core.models import AuditLog
from apps.core.testing import ERPTestCase
from apps.users.models import RolePermission, User


class AuthTests(ERPTestCase):
    def test_login_logout_and_me(self):
        c = APIClient()
        assert c.get("/api/auth/me/").status_code == 401
        bad = c.post("/api/auth/login/", {"email": "admin@test.local", "password": "wrong"})
        assert bad.status_code == 401 and bad.json()["message"] == "Invalid email or password."
        ok = c.post("/api/auth/login/", {"email": "ADMIN@test.local", "password": "s3cret-Pass!"})
        assert ok.status_code == 200
        body = ok.json()
        assert body["role"] == "admin" and body["active"] is True and "password" not in body
        assert c.get("/api/auth/me/").json()["email"] == "admin@test.local"
        assert AuditLog.objects.filter(action="login").exists()
        assert c.post("/api/auth/logout/").status_code == 204
        assert c.get("/api/auth/me/").status_code == 401

    def test_unknown_and_inactive_users_get_the_same_error(self):
        User.objects.filter(email="sales@test.local").update(is_active=False)
        c = APIClient()
        a = c.post("/api/auth/login/", {"email": "nobody@test.local", "password": "x"})
        b = c.post("/api/auth/login/", {"email": "sales@test.local", "password": "s3cret-Pass!"})
        assert a.status_code == b.status_code == 401
        assert a.json()["message"] == b.json()["message"]

    def test_csrf_is_enforced_for_session_authenticated_writes(self):
        c = APIClient(enforce_csrf_checks=True)
        c.force_login(self.users["admin"])
        r = c.put("/api/admin/settings/", {"companyName": "X"}, format="json")
        assert r.status_code == 403

    def test_unauthenticated_requests_are_rejected(self):
        c = APIClient()
        for url in ("/api/admin/users/", "/api/admin/audit/", "/api/admin/permissions/", "/api/admin/settings/"):
            assert c.get(url).status_code in (401, 403), url


class AdminTests(ERPTestCase):
    def test_only_admin_can_manage_users(self):
        for role in ("accounts", "warehouse", "sales"):
            assert self.client_as(role).get("/api/admin/users/").status_code == 403
        r = self.client_as("admin").get("/api/admin/users/")
        assert r.status_code == 200 and r.json()["count"] == 4

    def test_create_user_validates_and_hashes_password(self):
        c = self.client_as("admin")
        weak = c.post("/api/admin/users/", {"name": "N", "email": "n@test.local", "role": "sales", "password": "123"})
        assert weak.status_code == 400
        dup = c.post("/api/admin/users/", {"name": "N", "email": "sales@test.local", "role": "sales", "password": "Str0ng-Pass-99"})
        assert dup.status_code == 400
        ok = c.post("/api/admin/users/", {"name": "New", "email": "new@test.local", "role": "warehouse", "active": True, "password": "Str0ng-Pass-99"})
        assert ok.status_code == 201 and "password" not in ok.json()
        user = User.objects.get(email="new@test.local")
        assert user.password != "Str0ng-Pass-99" and user.check_password("Str0ng-Pass-99")
        assert AuditLog.objects.filter(entity_type="User", action="create").exists()

    def test_last_active_admin_is_protected(self):
        c = self.client_as("admin")
        admin = self.users["admin"]
        assert c.patch(f"/api/admin/users/{admin.pk}/", {"role": "sales"}).status_code == 400
        assert c.patch(f"/api/admin/users/{admin.pk}/", {"active": False}).status_code == 400
        assert c.delete(f"/api/admin/users/{admin.pk}/").status_code == 400
        assert User.objects.filter(pk=admin.pk).exists()

    def test_permission_matrix_can_only_be_changed_by_admin_and_applies_immediately(self):
        sales = self.client_as("sales")
        assert sales.get("/api/admin/permissions/").json()["sales"]["sales"] == "edit"
        denied = sales.put("/api/admin/permissions/", {"role": "sales", "module": "reports", "level": "edit"})
        assert denied.status_code == 403
        ok = self.client_as("admin").put("/api/admin/permissions/", {"role": "sales", "module": "admin", "level": "view"})
        assert ok.status_code == 200 and ok.json()["sales"]["admin"] == "view"
        assert RolePermission.objects.get(role="sales", module="admin").level == "view"
        locked = self.client_as("admin").put("/api/admin/permissions/", {"role": "admin", "module": "admin", "level": "view"})
        assert locked.status_code == 409

    def test_settings_readable_by_all_writable_by_admin(self):
        assert self.client_as("warehouse").get("/api/admin/settings/").status_code == 200
        assert self.client_as("warehouse").put("/api/admin/settings/", {"companyName": "X"}).status_code == 403
        data = self.client_as("admin").get("/api/admin/settings/").json()
        data["gstin"] = "BADGSTIN"
        assert self.client_as("admin").put("/api/admin/settings/", data).status_code == 400
        data["gstin"] = "29AABCT1234F1Z5"
        data["expiryAlertDays"] = 60
        ok = self.client_as("admin").put("/api/admin/settings/", data)
        assert ok.status_code == 200 and ok.json()["expiryAlertDays"] == 60

    def test_audit_trail_is_admin_only_and_paginated(self):
        self.client_as("admin").put("/api/admin/settings/", self.client_as("admin").get("/api/admin/settings/").json())
        assert self.client_as("accounts").get("/api/admin/audit/").status_code == 403
        r = self.client_as("admin").get("/api/admin/audit/")
        body = r.json()
        assert r.status_code == 200 and {"count", "results", "next", "previous"} <= set(body)
        assert body["results"][0]["entityType"] == "Settings"
