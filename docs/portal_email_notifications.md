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

`Link` is the portal deep-link (`<origin>/client-portal/projects/<id>`) — no secrets.

The Apps Script `doPost` `portal_notify` branch already mails `data.To` for any
event that carries a `To` + `Subject` (review_ready/final_delivered). `staff_assigned`
and `assignment_note` follow the same shape (`To` + `Subject` + `Message`/`Note`),
so they are covered by the existing recipient-has-`To` branch — extend the body
text if you want richer formatting (include `Role`/`Note`).

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
    const link = data.Link ? ("\n\nرابط المشروع: " + data.Link) : "";
    // review_update goes to Kian (admin); ALL other events carry a `To` recipient
    // (client or staff): review_ready, final_delivered, staff_assigned, assignment_note.
    if (data.Event === "review_update") {
      const action = data.Action === "approved" ? "اعتماد" : "طلب تعديل";
      MailApp.sendEmail(
        KIAN_ADMIN_EMAIL,
        data.Subject || "تحديث مراجعة من العميل - كيان",
        "مشروع: " + data["Project Name"] +
        "\nالمخرَج: " + data["Deliverable Title"] +
        "\nالإجراء: " + action +
        "\nالعميل: " + (data["Client Name"] || "") + " " + (data["Client Email"] || "") +
        "\nملاحظة: " + (data.Note || "—") + link
      );
    } else if (data.To) {
      // review_ready | final_delivered | staff_assigned | assignment_note
      var body = "";
      if (data["Project Name"])      body += "مشروع: " + data["Project Name"] + "\n";
      if (data["Deliverable Title"]) body += "المخرَج: " + data["Deliverable Title"] + "\n";
      if (data["Role"])              body += "الدور: " + data["Role"] + "\n";
      body += "\n" + (data.Message || "");
      if (data["Note"])              body += "\nملاحظة: " + data["Note"];
      MailApp.sendEmail(data.To, data.Subject || "تحديث من كيان", body + link);
    }
    return ContentService.createTextOutput("ok");
  }

  // ... existing quote/meeting/upload handling stays unchanged ...
}
```

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
