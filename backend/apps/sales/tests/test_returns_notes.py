from decimal import Decimal

from apps.core.testing import TODAY, ERPTestCase
from apps.inventory.models import StockMovement
from apps.inventory.stock import bucket_map
from apps.sales.models import NoteDocument, SalesReturn

from .helpers import SalesFlowMixin


class SalesReturnTests(SalesFlowMixin, ERPTestCase):
    def setUp(self):
        super().setUp()
        self.batch = self.make_batch(qty=500, batch_no="R-1", cost=Decimal("10.00"))
        self.inv = self.make_invoice(self.dist_local, qty=7, batch=self.batch)  # 7 sold: 500 -> 493 saleable

    def buckets(self):
        return bucket_map([self.batch.pk])[self.batch.pk]

    def payload(self, qty, cls, **extra):
        return {"invoiceId": self.inv["id"], "date": str(TODAY), "reason": "damaged", "notes": "", "issueCreditNote": False,
                "lines": [{"productId": self.product.pk, "batchId": self.batch.pk, "qty": qty, "classification": cls}], **extra}

    def post_return(self, payload, role="sales"):
        return self.client_as(role).post("/api/sales/returns/", payload, format="json")

    def test_stock_disposition_follows_the_classification(self):
        self.assertEqual(self.buckets()["saleable"], 493)
        self.assertEqual(self.post_return(self.payload(1, "saleable")).status_code, 201)
        self.assertEqual(self.buckets()["saleable"], 494)  # only saleable goods rejoin sellable stock
        self.assertEqual(self.post_return(self.payload(2, "damaged")).status_code, 201)
        self.assertEqual(self.post_return(self.payload(1, "expired")).status_code, 201)
        self.assertEqual(self.post_return(self.payload(1, "inspection")).status_code, 201)
        b = self.buckets()
        self.assertEqual((b["saleable"], b["damaged"], b["expired"], b["inspection"]), (494, 2, 1, 1))
        self.assertEqual(StockMovement.objects.filter(type="sales_return").count(), 4)

    def test_over_return_rejected_and_nothing_persisted(self):
        self.assertEqual(self.post_return(self.payload(5, "saleable")).status_code, 201)
        r = self.post_return(self.payload(3, "saleable"))  # only 2 left to return
        self.assertEqual(r.status_code, 400)
        self.assertIn("exceeds the quantity still returnable (2)", r.json()["message"])
        self.assertEqual(SalesReturn.objects.count(), 1)
        self.assertEqual(self.buckets()["saleable"], 498)
        # Duplicate lines in one request are summed against the remaining quantity.
        line = {"productId": self.product.pk, "batchId": self.batch.pk, "qty": 2, "classification": "saleable"}
        r = self.post_return({**self.payload(1, "saleable"), "lines": [line, line]})
        self.assertEqual(r.status_code, 400)
        self.assertEqual(SalesReturn.objects.count(), 1)

    def test_invalid_lines_rejected(self):
        self.assertEqual(self.post_return(self.payload(0, "saleable")).status_code, 400)
        self.assertEqual(self.post_return(self.payload(1, "unknown")).status_code, 400)
        self.assertEqual(self.post_return({**self.payload(1, "saleable"), "lines": []}).status_code, 400)
        other_batch = self.make_batch(self.product, qty=10, batch_no="R-2")
        bad = {**self.payload(1, "saleable"), "lines": [{"productId": self.product.pk, "batchId": other_batch.pk, "qty": 1, "classification": "saleable"}]}
        self.assertEqual(self.post_return(bad).status_code, 400)
        self.assertEqual(SalesReturn.objects.count(), 0)

    def test_returnable_lines_endpoint_tracks_returns(self):
        self.post_return(self.payload(3, "saleable"))
        rows = self.client_as("sales").get(f"/api/sales/returns/returnable-lines/?invoiceId={self.inv['id']}").json()["results"]
        self.assertEqual([(r["invoiced"], r["returned"], r["remaining"], r["batchNo"]) for r in rows], [(7, 3, 4, "R-1")])

    def test_reclassify_inspection_line(self):
        r = self.post_return(self.payload(2, "inspection"))
        rid = r.json()["id"]
        self.assertEqual(r.json()["status"], "pending_inspection")
        self.assertEqual(self.buckets()["inspection"], 2)
        done = self.client_as("warehouse").post(f"/api/sales/returns/{rid}/reclassify/", {"lineIndex": 0, "to": "saleable", "note": "Pack intact"}, format="json")
        self.assertEqual(done.status_code, 403)  # warehouse has only view on sales
        done = self.client_as("sales").post(f"/api/sales/returns/{rid}/reclassify/", {"lineIndex": 0, "to": "saleable", "note": "Pack intact"}, format="json")
        self.assertEqual(done.status_code, 200, done.content)
        body = done.json()
        self.assertEqual((body["status"], body["lines"][0]["classification"], body["lines"][0]["dispositionNote"]), ("reconciled", "saleable", "Pack intact"))
        b = self.buckets()
        self.assertEqual((b["inspection"], b["saleable"]), (0, 493 + 2))
        self.assertEqual(StockMovement.objects.filter(type="reclassification").count(), 2)
        # Only lines still awaiting inspection can be decided.
        again = self.client_as("sales").post(f"/api/sales/returns/{rid}/reclassify/", {"lineIndex": 0, "to": "damaged"}, format="json")
        self.assertEqual(again.status_code, 400)
        self.assertEqual(self.client_as("sales").post(f"/api/sales/returns/{rid}/reclassify/", {"lineIndex": 5, "to": "damaged"}, format="json").status_code, 400)

    def test_credit_note_gst_intra_state(self):
        r = self.post_return(self.payload(2, "saleable", issueCreditNote=True))
        body = r.json()
        note = NoteDocument.objects.get(pk=body["creditNoteId"])
        # 2 x 15.00 less 10% = 27.00 taxable; 18% = 4.86 -> CGST 2.43 + SGST 2.43
        self.assertEqual((note.taxable, note.cgst, note.sgst, note.igst, note.total), (Decimal("27.00"), Decimal("2.43"), Decimal("2.43"), Decimal("0"), Decimal("31.86")))
        self.assertEqual((note.type, note.invoice_id, note.sales_return_id), ("credit", self.inv["id"], body["id"]))
        self.assertEqual(body["creditNoteNo"], note.note_no)
        self.assertEqual(self.dec(body["value"]), Decimal("27.00"))
        inv = self.client_as("accounts").get(f"/api/sales/invoices/{self.inv['id']}/").json()
        self.assertEqual((self.dec(inv["credited"]), self.dec(inv["outstanding"]), inv["payStatus"]), (Decimal("31.86"), Decimal("80.14"), "partial"))

    def test_credit_note_gst_inter_state(self):
        inv = self.make_invoice(self.dist_other, qty=7, batch=self.batch)
        payload = {**self.payload(2, "damaged", issueCreditNote=True), "invoiceId": inv["id"]}
        note = NoteDocument.objects.get(pk=self.post_return(payload).json()["creditNoteId"])
        self.assertEqual((note.taxable, note.cgst, note.sgst, note.igst, note.total), (Decimal("27.00"), Decimal("0"), Decimal("0"), Decimal("4.86"), Decimal("31.86")))

    def test_return_without_credit_note_and_permissions(self):
        body = self.post_return(self.payload(1, "saleable")).json()
        self.assertIsNone(body["creditNoteId"])
        self.assertEqual(NoteDocument.objects.count(), 0)
        self.assertEqual(self.post_return(self.payload(1, "saleable"), role="warehouse").status_code, 403)
        self.assertIn(self.client_as(None).post("/api/sales/returns/", self.payload(1, "saleable"), format="json").status_code, (401, 403))
        self.assertEqual(self.client_as("warehouse").get("/api/sales/returns/").json()["count"], 1)

    def test_listing_search_and_detail(self):
        r = self.post_return(self.payload(1, "saleable")).json()
        c = self.client_as("accounts")
        self.assertEqual(c.get(f"/api/sales/returns/{r['id']}/").json()["invoiceNo"], self.inv["invoiceNo"])
        self.assertEqual(c.get("/api/sales/returns/?search=RET-").json()["count"], 1)
        self.assertEqual(c.get("/api/sales/returns/?reason=expired").json()["count"], 0)


class NoteTests(SalesFlowMixin, ERPTestCase):
    def note(self, **kw):
        body = {"type": "credit", "distributorId": self.dist_local.pk, "invoiceId": None, "date": str(TODAY), "reason": "Rate difference", "taxable": "100.00", "gstRate": 18, **kw}
        return self.client_as("accounts").post("/api/sales/notes/", body, format="json")

    def test_manual_notes_compute_gst_on_the_server(self):
        d = self.dec
        n = self.note().json()
        self.assertEqual((d(n["taxable"]), d(n["cgst"]), d(n["sgst"]), d(n["igst"]), d(n["total"])), (Decimal("100.00"), Decimal("9.00"), Decimal("9.00"), Decimal("0"), Decimal("118.00")))
        self.assertTrue(n["noteNo"].startswith("CN-"))
        inter = self.note(distributorId=self.dist_other.pk, type="debit").json()
        self.assertEqual((d(inter["cgst"]), d(inter["igst"]), d(inter["total"])), (Decimal("0"), Decimal("18.00"), Decimal("118.00")))
        self.assertTrue(inter["noteNo"].startswith("DN-"))
        # A client-supplied total is not accepted.
        forged = self.note(total=1, igst=0, cgst=0).json()
        self.assertEqual(d(forged["total"]), Decimal("118.00"))

    def test_note_uses_the_linked_invoice_tax_type(self):
        inv = self.make_invoice(self.dist_other)
        n = self.note(distributorId=self.dist_other.pk, invoiceId=inv["id"]).json()
        self.assertEqual((self.dec(n["igst"]), n["invoiceNo"]), (Decimal("18.00"), inv["invoiceNo"]))

    def test_credit_reduces_and_debit_increases_outstanding(self):
        inv = self.make_invoice()  # 112
        self.note(invoiceId=inv["id"])  # credit 118 -> floors at zero outstanding
        row = self.client_as("accounts").get(f"/api/sales/invoices/{inv['id']}/").json()
        self.assertEqual((self.dec(row["credited"]), self.dec(row["outstanding"])), (Decimal("118.00"), Decimal("0")))
        inv2 = self.make_invoice(qty=4)
        self.note(type="debit", invoiceId=inv2["id"], taxable="10.00", gstRate=0)
        row2 = self.client_as("accounts").get(f"/api/sales/invoices/{inv2['id']}/").json()
        self.assertEqual((self.dec(row2["debited"]), self.dec(row2["outstanding"])), (Decimal("10.00"), self.dec(inv2["total"]) + Decimal("10.00")))

    def test_validation(self):
        inv = self.make_invoice(self.dist_other)
        self.assertEqual(self.note(taxable="0").status_code, 400)
        self.assertEqual(self.note(taxable="-5").status_code, 400)
        self.assertEqual(self.note(reason="  ").status_code, 400)
        self.assertEqual(self.note(gstRate=150).status_code, 400)
        self.assertEqual(self.note(invoiceId=inv["id"]).status_code, 400)  # invoice belongs to another distributor
        self.assertEqual(NoteDocument.objects.count(), 0)

    def test_permissions_and_listing(self):
        self.note()
        body = {"type": "credit", "distributorId": self.dist_local.pk, "date": str(TODAY), "reason": "x", "taxable": "1", "gstRate": 0}
        self.assertEqual(self.client_as("warehouse").post("/api/sales/notes/", body, format="json").status_code, 403)
        self.assertIn(self.client_as(None).get("/api/sales/notes/").status_code, (401, 403))
        listing = self.client_as("warehouse").get("/api/sales/notes/?type=credit").json()
        self.assertEqual(listing["count"], 1)
        self.assertEqual(listing["results"][0]["distributorName"], "Local Traders")
