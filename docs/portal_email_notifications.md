# Portal email notifications (review workflow)

Status: **client-side emit implemented; email delivery NOT yet live.** Delivery
goes live only after the Google Apps Script Web App is extended (Step 2 below)
and re-deployed by the owner. Nothing here is verified end-to-end yet.

WhatsApp is **deferred** — see the bottom of this file.

---

## How it works

We reuse the **same** Google Apps Script Web App the quote forms already use
(`lib/submitForm.ts` → `SHEETS_ENDPOINT`). All mail credentials stay inside the
Apps Script (server-side) — there are **no SMTP/provider keys and no
service-role key in the browser**.

The browser POSTs a fire-and-forget event (`mode: "no-cors"`, opaque) with
`_type: "portal_notify"`. Helper: [`lib/portal/notifyEmail.ts`](../lib/portal/notifyEmail.ts).

| Event | Fired from | Trigger | Recipient |
|---|---|---|---|
| `review_ready` | admin browser | deliverable added with / moved to `client_review` | the client (`To` field, resolved by the admin from `clients.email`) |
| `review_update` | client browser | client approves or requests revision | Kian admin address **configured inside the Apps Script** (never sent from the client) |
| `final_delivered` | admin browser | deliverable moved to `final_delivered` | the client (`To` field, resolved by the admin) |
| `staff_assigned` | admin browser | a staff member is assigned to a project | the staff member (`To` field, resolved by the admin) |
| `assignment_note` | admin browser | an assignment note is added (after the finance/notes addendum is run) | the assigned staff member (`To` field) |
| `opportunity_new` | public (anon) opportunities page | a new opportunity request is submitted | Kian inbox (NO `To` → routed to `KIAN_ADMIN_EMAIL`) |
| `opportunity_ack` | public (anon) opportunities page | a new opportunity request is submitted | the applicant (`To` field) |

### Payload keys

`review_ready`: `_type=portal_notify`, `Event`, `Subject` ("عملك جاهز للمعاينة - كيان"),
`To`, `Project Name`, `Deliverable Title`, `Message`, `Link`.

`review_update`: `_type=portal_notify`, `Event`, `Subject` ("تحديث مراجعة من العميل - كيان"),
`Project Name`, `Deliverable Title`, `Action` (`approved`|`revision_requested`),
`Note`, `Client Name`, `Client Email`, `Link`.

`final_delivered`: `_type=portal_notify`, `Event`, `Subject` ("تم التسليم النهائي - كيان"),
`To`, `Project Name`, `Deliverable Title`, `Message`, `Link`.

`staff_assigned`: `_type=portal_notify`, `Event`, `Subject` ("تم تكليفك بمشروع - كيان"),
`To`, `Staff Name`, `Project Name`, `Role`, `Note`, `Message`, `Link`.

`assignment_note`: `_type=portal_notify`, `Event`, `Subject` ("ملاحظة جديدة على تكليفك - كيان"),
`To`, `Staff Name`, `Project Name`, `Note`, `Message`, `Link`.

`opportunity_new`: `_type=portal_notify`, `Event`, `Subject` ("طلب فرصة جديد - كيان"),
`Opportunity Type`, `Applicant`, `Email`, `Phone`, `City`, `Note`, `Request Number`,
`Message`, `Link` (→ `/client-portal/opportunities`). **No `To`** → goes to Kian.

`opportunity_ack`: `_type=portal_notify`, `Event`, `Subject` ("تم استلام طلبك - كيان"),
`To` (applicant), `Applicant`, `Request Number`, `Message`.

`Link` is a portal deep-link — no secrets.

ROUTING RULE (generalized in the handler below): an event WITH a `To` goes to that
recipient (client/staff/applicant); an event WITHOUT a `To` goes to `KIAN_ADMIN_EMAIL`
(currently `review_update` and `opportunity_new`). This covers every event above.

---

## Step 2 — REQUIRED Apps Script handler (owner action)

Add this branch to the existing `doPost(e)` in the Apps Script project, set
`KIAN_ADMIN_EMAIL`, then **Deploy → Manage deployments → edit → new version**
(re-using the same `/exec` URL so no app change is needed):

```js
const KIAN_ADMIN_EMAIL = "owner@kianmedia.com"; // <-- set the real Kian inbox

function doPost(e) {
  const data = JSON.parse(e.postData.contents);

  if (data._type === "portal_notify") {
    const link = data.Link ? ("\n\nرابط: " + data.Link) : "";
    // Build a generic body from whichever fields are present.
    var body = "";
    if (data["Project Name"])      body += "مشروع: " + data["Project Name"] + "\n";
    if (data["Deliverable Title"]) body += "المخرَج: " + data["Deliverable Title"] + "\n";
    if (data["Opportunity Type"])  body += "نوع الفرصة: " + data["Opportunity Type"] + "\n";
    if (data["Applicant"])         body += "مقدّم الطلب: " + data["Applicant"] + "\n";
    if (data["Role"])              body += "الدور: " + data["Role"] + "\n";
    if (data["Email"])             body += "البريد: " + data["Email"] + "\n";
    if (data["Phone"])             body += "الجوال: " + data["Phone"] + "\n";
    if (data["City"])              body += "المدينة: " + data["City"] + "\n";
    if (data["Action"])            body += "الإجراء: " + (data.Action === "approved" ? "اعتماد" : "طلب تعديل") + "\n";
    if (data["Client Name"] || data["Client Email"]) body += "العميل: " + (data["Client Name"] || "") + " " + (data["Client Email"] || "") + "\n";
    if (data["Request Number"])    body += "رقم الطلب: " + data["Request Number"] + "\n";
    body += "\n" + (data.Message || "");
    if (data["Note"])              body += "\nملاحظة: " + data["Note"];

    // ROUTING: events WITH a `To` go to that recipient (client/staff/applicant);
    // events WITHOUT a `To` go to the Kian inbox (review_update, opportunity_new).
    var to = data.To || KIAN_ADMIN_EMAIL;
    MailApp.sendEmail(to, data.Subject || "تحديث من كيان", body + link);
    return ContentService.createTextOutput("ok");
  }

  // ... existing quote/meeting/upload handling stays unchanged ...
}
```

This single generic block replaces any earlier per-event version and covers all
events: `review_ready`, `review_update`, `final_delivered`, `staff_assigned`,
`assignment_note`, `opportunity_new`, `opportunity_ack`.

---

## Environment variables

**No new Vercel env vars are required.** The endpoint is the existing
`SHEETS_ENDPOINT` constant in `lib/submitForm.ts`. The only configuration is the
`KIAN_ADMIN_EMAIL` constant **inside the Apps Script** (Step 2), not in this repo.

Optional (not currently wired): if you ever want to move the endpoint to an env
var, add `NEXT_PUBLIC_SHEETS_ENDPOINT` in Vercel → Project → Settings →
Environment Variables, and read it in `lib/submitForm.ts`. Not needed today.

## Not yet done (future, optional)

- Gate sends on `notification_preferences.email_enabled` per recipient.
- Confirm delivery (the `no-cors` POST is opaque, so the browser can't read the
  Apps Script response — verify by checking the inbox after Step 2).

---

## WhatsApp — DEFERRED

WhatsApp notifications are deferred and will be wired later through approved
WhatsApp Cloud API / n8n webhook configuration. Do not build the WhatsApp API
path now.
