# User acceptance test scripts

For a person, not a machine, to run before a release. Each script is a job the product exists for, done by the role that does it. The automated suites prove the parts work; these prove the whole makes sense to the people using it.

**Where:** a staging copy with the demo seed loaded, never the live site. The demo accounts share one password, which the seed prints when it runs; it is not written here.

**How to record:** for each step, mark **Pass**, **Fail** (with a screenshot and what you expected), or **Blocked**. A script passes when every step passes. Known defects that affect a script are listed with it; a step that fails only because of one is marked **Known**, not Fail.

**Sign-off:** the business owner of the area signs each script, with the date and the commit being released.

Some expected results describe how the product *should* behave, not how it is known to behave. A step that surprises the tester is exactly what these scripts are for: record it as a Fail, and it goes into the defect register.

---

### UAT-01: Signing in and staying signed in as the right person

People: any two demo accounts (for example `grc.manager@omniops.me` and `risk.manager@omniops.me`).

1. Open the site. Expect the customer sign-in page.
2. Sign in as the first person. Expect their organisation's dashboard, with their name at the top right.
3. Duplicate the tab. In the new tab, sign out, then sign in as the second person.
4. Go back to the first tab. Expect a notice naming both people, asking which to continue as. The first tab must not show the second person's data without that notice.
5. Choose "Continue as" the second person. Expect the dashboard to reload as them.
6. On a phone, open the sign-in page. Expect the e-mail and password fields on screen without scrolling sideways. *Known: QA-007.*

### UAT-02: A policy document from draft to read-and-acknowledged

People: `eleanor.vance@globalbank.com` (Compliance Manager), `sarah.jenkins@globalbank.com` (approver), `alex.rivera@globalbank.com` (staff).

1. As Eleanor, open **Document Library** and create a policy. Expect it as Draft, with Eleanor as owner.
2. Send it for approval to Sarah. Expect it in Sarah's **To Do & Approvals**.
3. As Sarah, approve it. Expect to be asked for the password again; approval without it must not be possible.
4. As Eleanor, try to approve your own document. Expect to be refused. Separation of duties: the author does not approve.
5. Publish it to Everyone. Expect it to become Published, with a version number.
6. As Alex, open **My Acknowledgements**. Expect the policy there. Open it: the PDF must display in the reader. Acknowledge it.
7. As Eleanor, open **Immutable Audit Log**. Expect create, approve, publish and acknowledge entries, with who and when.

### UAT-03: Running ISO 27001 for an organisation (OmniOps)

People: `grc.manager@omniops.me` (owner), `risk.manager@omniops.me` (operator), `internal.audit@omniops.me` (assessor).

1. As the GRC manager, open **Standard Enablement** and enable ISO/IEC 27001. Expect its controls under **Mandated Controls**.
2. Open a control and assign the risk manager as operator and internal audit as assessor.
3. As the risk manager, open **Implementations & Evidence**, record the implementation and attach evidence.
4. As internal audit, assess the control. Expect the assessor to be unable to edit the evidence they are assessing.
5. As the GRC manager, export the coverage report. Expect a spreadsheet whose figures match the screen.
6. Look for the Statement of Applicability and management-review records. *Known gap: OI-06. Record what you had to do outside the product.*

### UAT-04: A risk from identification to acceptance

People: `risk.manager@omniops.me`, `grc.manager@omniops.me`.

1. Open **Consolidated Risk** and raise a risk with likelihood and impact. Expect an inherent score.
2. Link it to an asset in **Asset Register** and to a control.
3. Record a treatment. Expect a residual score, with the reason for any change recorded.
4. Where the residual is above appetite, expect the product to say so, and to require an acceptance by someone other than the risk owner.
5. Open **Key Risk Indicators** and **Loss Events**, and check that the risk appears where you would look for it.

### UAT-05: Support looks at a customer's account, with the customer's permission

People: a platform support operator, and the customer's organisation administrator.

1. As support, open **Impersonation Sessions** and request access to the customer's organisation, with a reason and a duration.
2. Expect the customer's administrator to be notified, and nobody at the customer outside the approver roles. *Open item OI-04: note if HR roles are offered as approvers.*
3. As the customer's administrator, approve. As support, start the session. Expect a banner saying whose account you are in, on every screen.
4. End the session. Expect the banner gone, and the customer's audit trail to show the session: who, why, when, and for how long.

### UAT-06: Billing an organisation and taking payment

People: `billing@grcwisdom.com`, and a finance role in the customer organisation.

1. As billing, preview the next invoice. Expect the amounts to match the subscription.
2. Issue it. Expect a ZATCA QR code and hash on the invoice. *Known: QA-011. The QR is a placeholder today and must not go to a real customer.*
3. Mark it paid. Then try to mark it paid again. Expect a refusal. *Known: QA-013.*
4. As a finance user of a different organisation, try to reach the first organisation's invoice. Expect no way to see it or pay it. *Known: QA-012.*

### UAT-07: A service request with an approval

People: a staff member and their approver in one organisation.

1. As staff, open **ITSM Service Desk** and raise a request that needs approval.
2. As the approver, find it in **To Do & Approvals** and approve it. Expect the ticket to move on.
3. As a third member of the organisation, try to cancel the running approval. Expect to be refused. *Known: QA-001.*
4. Open **Knowledge Base** and read a published article. Drafts must not be visible to readers. *Known: QA-002 for cross-organisation access.*

### UAT-08: Bringing on a new customer organisation

People: the platform administrator.

1. Open **Manage Tenants** and create an organisation with its first administrator.
2. Sign in as that administrator. Expect to be made to change the password before anything else.
3. As that administrator, open **Users & Branch Transfers** and add a user. *Known: QA-014. The screen currently goes blank; record it as Known and continue from the next step.*
4. Set the organisation's branding. Expect the change on the new organisation only. *Known: QA-006.*
5. Check the plan list on the tenant screen is populated. *Known: QA-008 for non-database-administrators.*

### UAT-09: The audit trail an auditor relies on

People: `internal.audit@omniops.me`, and a staff member.

1. As staff, try to open the organisation's audit trail. Expect no way to reach it.
2. As internal audit, open it. Expect entries for the work done in the scripts above.
3. Run the chain verification. Expect VALID, and the date since which it is valid.

### UAT-10: The live site after a deploy

People: whoever deployed.

1. Run the synthetic check against the live address: `SITE=https://… node grc_wisdom_api/scripts/monitor/synthetic-check.js`. Expect exit code 0.
2. Open the site on a phone and a laptop, sign in, and open three screens.
3. Confirm the address bar shows a padlock. Plain HTTP is a failure (OI-01).
