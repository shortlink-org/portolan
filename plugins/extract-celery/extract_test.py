"""The reader, held to two fixtures.

`testdata/billing` is a Django project with Celery in it, each shape this
plugin claims to read present once; `testdata/drift` is the tree where every
diagnostic the reader is meant to raise is raised once. `expected.json` beside
each is what it comes out as. Set UPDATE_GOLDEN=1 to write them again after a
deliberate change, and read the diff.
"""

import json
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(1, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "pyplugin"))

import main  # noqa: E402
from extract import extract  # noqa: E402
from options import Options  # noqa: E402
from protocol import Builder, Input  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))


def run(fixture, options):
    b = Builder()
    extract(
        Input(root=os.path.relpath(os.path.join(HERE, "testdata", fixture), ROOT)),
        Options.of(options),
        b,
        cwd=ROOT,
    )
    return {f.name: f.contents for f in b.files}, b.warnings


def golden(test, fixture, contents):
    path = os.path.join(HERE, "testdata", fixture, "expected.json")
    if os.environ.get("UPDATE_GOLDEN"):
        with open(path, "w", encoding="utf-8") as handle:
            handle.write(contents)
    with open(path, "r", encoding="utf-8") as handle:
        test.assertEqual(json.loads(handle.read()), json.loads(contents))


class Billing(unittest.TestCase):
    def setUp(self):
        self.files, self.warnings = run("billing", {"context": "shop", "service": "billing"})
        self.fragment = json.loads(self.files["celery.json"])
        self.service = self.fragment["contexts"][0]["services"][0]
        self.channels = {c["address"]: c for c in self.service["channels"]}
        self.flows = {f["slug"]: f for f in self.fragment["flows"]}

    def test_the_fragment_it_reads(self):
        golden(self, "billing", self.files["celery.json"])

    def test_a_tree_where_everything_joins_reports_nothing(self):
        self.assertEqual(self.warnings, [])

    def test_a_queue_is_a_job_channel_with_a_send_and_a_receive_per_task(self):
        self.assertEqual(sorted(self.channels), ["billing", "billing.mail", "billing.slow"])
        mail = self.channels["billing.mail"]
        self.assertEqual(mail["kind"], "job")
        self.assertEqual([(m["name"], m["direction"]) for m in mail["messages"]], [("invoices.tasks.send_invoice_email", "send"), ("invoices.tasks.send_invoice_email", "receive")])
        self.assertIn("over redis", mail["doc"])

    def test_a_queue_is_decided_the_way_celery_decides_it(self):
        receive = {c: [m for m in ch["messages"] if m["direction"] == "receive"][0]["doc"] for c, ch in self.channels.items()}
        self.assertIn("routed by task_routes", receive["billing.mail"])
        self.assertIn("named on the task", receive["billing.slow"])
        self.assertIn("the default queue", receive["billing"])

    def test_a_name_given_on_the_decorator_is_the_wire_name(self):
        self.assertEqual(self.channels["billing"]["messages"][0]["name"], "billing.archive_invoice")

    def test_an_enqueue_inside_on_commit_is_noted_and_a_countdown_too(self):
        self.assertTrue(self.flows["billing-celery-send-invoice-email"]["steps"][0]["note"].startswith("Enqueued after the transaction commits."))
        self.assertTrue(self.flows["billing-celery-remind-unpaid-invoice"]["steps"][0]["note"].startswith("Enqueued for later, with a countdown or an eta."))

    def test_the_partial_form_and_the_module_import_resolve_to_the_task(self):
        step = self.flows["billing-celery-archive-invoice"]["steps"][0]
        self.assertTrue(step["line"].endswith("invoices/handlers.py:15"))
        self.assertIn("Also enqueued at plugins/extract-celery/testdata/billing/invoices/services.py:23.", step["note"])

    def test_the_clock_is_a_producer_and_opens_a_flow_of_its_own(self):
        # Nothing in the code enqueues close_stale_drafts: add_periodic_task does.
        flow = self.flows["billing-celery-close-stale-drafts"]
        self.assertEqual([p["id"] for p in flow["participants"]], ["celery-beat", "shop.billing", "celery-billing"])
        self.assertEqual([(s["from"], s["to"], s["label"]) for s in flow["steps"]], [("celery-beat", "celery-billing", "enqueue close_stale_drafts"), ("celery-billing", "shop.billing", "close_stale_drafts")])
        self.assertEqual(flow["trigger"], {"kind": "scheduled", "label": "cron 0 3 * * *", "confidence": "high"})
        self.assertTrue(flow["steps"][0]["line"].endswith("config/celery.py:22"))
        self.assertTrue(flow["steps"][0]["note"].startswith("Scheduled cron 0 3 * * * (`close-stale-drafts`)."))
        sent = [m for m in self.channels["billing"]["messages"] if m["name"] == "invoices.tasks.close_stale_drafts"]
        self.assertEqual([m["direction"] for m in sent], ["send", "receive"])
        self.assertTrue(sent[0]["doc"].startswith("Sent by Celery beat, cron 0 3 * * * (`close-stale-drafts`)."))
        self.assertNotIn("Nothing in this tree enqueues it.", sent[1]["doc"])

    def test_a_task_the_code_and_the_clock_both_enqueue_has_two_flows(self):
        self.assertIn("billing-celery-remind-unpaid-invoice", self.flows)
        beat = self.flows["billing-celery-remind-unpaid-invoice-beat"]
        self.assertEqual(beat["trigger"]["label"], "every 6h")
        self.assertEqual(beat["steps"][1]["handoff"], self.flows["billing-celery-remind-unpaid-invoice"]["steps"][1]["handoff"])

    def test_the_settings_entries_are_read_too(self):
        archive = self.flows["billing-celery-archive-invoice-beat"]
        self.assertEqual(archive["participants"][2]["id"], "celery-billing")
        self.assertEqual(archive["trigger"]["label"], "cron 30 2 * * *")
        self.assertTrue(archive["source"].endswith("config/settings.py"))

    def test_a_flow_goes_out_to_the_broker_and_comes_back(self):
        flow = self.flows["billing-celery-send-invoice-email"]
        self.assertEqual([p["id"] for p in flow["participants"]], ["shop.billing", "celery-billing-mail"])
        self.assertEqual([(s["from"], s["to"], s["label"]) for s in flow["steps"]], [("shop.billing", "celery-billing-mail", "enqueue send_invoice_email"), ("celery-billing-mail", "shop.billing", "send_invoice_email")])
        self.assertTrue(flow["steps"][1]["line"].endswith("invoices/tasks.py:13"))
        self.assertEqual(flow["trigger"], {"kind": "job", "label": "Celery · billing.mail", "confidence": "high"})
        self.assertEqual(
            [(step["handoff"]["direction"], step["handoff"]["message"]) for step in flow["steps"]],
            [("send", "invoices.tasks.send_invoice_email"), ("receive", "invoices.tasks.send_invoice_email")],
        )
        self.assertEqual(flow["steps"][1]["continuesAt"], "python:invoices.tasks:send_invoice_email")


class Drift(unittest.TestCase):
    def setUp(self):
        self.files, self.warnings = run("drift", {"context": "ops", "service": "reports"})
        self.fragment = json.loads(self.files["celery.json"])
        self.channels = {c["address"]: c for c in self.fragment["contexts"][0]["services"][0]["channels"]}

    def test_the_fragment_it_reads(self):
        golden(self, "drift", self.files["celery.json"])

    def test_every_diagnostic_once(self):
        self.assertEqual(
            [(w.ref.split("/")[-1], w.message.split(",")[0].split(":")[0]) for w in self.warnings],
            [
                ("ops.reports", "settings module `config.settings` not found"),
                ("ops.reports", "task_routes pattern `reports.tasks.*` matches no task in this tree"),
                ("services.py:19", "`mail.tasks.send_receipt` is sent as a task no function in this tree declares; recorded as a send with no handler here"),
                ("services.py:23", "`helper` is enqueued"),
                ("celery.py:15", "beat entry `nightly` schedules `reports.tasks.nightly`"),
                ("celery.py:16", "beat entry `rebuild` has a schedule this reader cannot read as syntax"),
                ("tasks.py:19", "task `jobs.tasks.orphan` is declared"),
            ],
        )

    def test_the_app_module_configures_the_queue_when_the_settings_are_missing(self):
        self.assertEqual(sorted(self.channels), ["mail", "rebuild", "reports.default"])
        self.assertIn("over amqp", self.channels["mail"]["doc"])

    def test_a_chain_is_one_enqueue_per_signature_noted_as_such(self):
        notes = [f["steps"][0]["note"] for f in self.fragment["flows"] if f["trigger"]["kind"] == "job"]
        self.assertTrue(all(n.startswith("Enqueued in a chain.") for n in notes))
        self.assertEqual(len(notes), 2)

    def test_a_task_sent_by_name_to_another_tree_is_a_send_with_no_handler(self):
        self.assertEqual([m["direction"] for m in self.channels["mail"]["messages"]], ["send"])
        self.assertEqual([f["slug"] for f in self.fragment["flows"]], ["reports-celery-build-report", "reports-celery-build-report-beat", "reports-celery-deliver-report"])

    def test_an_opaque_schedule_is_kept_as_written_and_the_entry_options_place_the_task(self):
        beat = [f for f in self.fragment["flows"] if f["slug"] == "reports-celery-build-report-beat"][0]
        self.assertEqual(beat["trigger"], {"kind": "scheduled", "label": "every_other_day()", "confidence": "high"})
        # The code enqueues build_report on the default queue; the entry's
        # options put the scheduled run on one of its own.
        self.assertEqual(beat["participants"][2]["id"], "celery-rebuild")
        self.assertEqual([m["direction"] for m in self.channels["rebuild"]["messages"]], ["send", "receive"])

    def test_a_task_nothing_enqueues_is_still_worked(self):
        orphan = [m for m in self.channels["reports.default"]["messages"] if m["name"] == "jobs.tasks.orphan"]
        self.assertEqual([m["direction"] for m in orphan], ["receive"])
        self.assertIn("Nothing in this tree enqueues it.", orphan[0]["doc"])


class Protocol(unittest.TestCase):
    def test_describe_answers_with_the_options_schema(self):
        out = json.loads(main.serve(json.dumps({"portolanVersion": "0.1.0", "kind": "describe"})))
        self.assertEqual(out["files"], [])
        self.assertEqual(out["describe"]["name"], "extract-celery")
        self.assertEqual(out["describe"]["options"]["additionalProperties"], False)
        self.assertIn("settings", out["describe"]["options"]["properties"])

    def test_an_option_nobody_reads_is_refused_rather_than_dropped(self):
        with self.assertRaises(ValueError):
            Options.of({"context": "shop", "setings": "config.settings"})

    def test_no_tasks_is_said_rather_than_an_empty_fragment_nobody_questions(self):
        _, warnings = run("billing", {"context": "shop", "service": "billing", "source": "config"})
        self.assertIn("no Celery tasks under", warnings[0].message)


if __name__ == "__main__":
    unittest.main()
