/**
 * Bringing a consulting firm onto an engagement the way the product requires
 * once consulting is switched on (sprint 4): the organisation invites the
 * firm, the firm's person accepts and is nominated Lead, and the organisation
 * approves them. Used by the engagement verify scripts that need a firm on an
 * engagement; engagement-s4-relationship-test checks the flow itself.
 *
 * Returns the firm's tenant, or throws saying which step was refused.
 */
const q = require('./qa/lib');

async function bringFirm({ clientToken, leadLogin, projectId, firmName = 'GRC Consulting Partners', prisma }) {
  const firm = await prisma.tenant.findFirst({ where: { name: firmName }, select: { id: true, name: true } });
  if (!firm) throw new Error(`no tenant named ${firmName}`);
  const step = async (what, who, method, url, body) => {
    const r = await q.call(method, url, { token: who, body });
    if (r.status >= 300) throw new Error(`${what}: HTTP ${r.status} ${r.json?.code || ''} ${r.json?.message || r.text}`);
    return r.json;
  };
  const inv = (await step('invite the firm', clientToken, 'POST', '/api/engagements/invitations', { projectId, firmTenantId: firm.id })).invitation;
  await step('accept the invitation', leadLogin.token, 'POST', `/api/engagements/invitations/${inv.id}/accept`);
  const members = (await step('read the engagement', clientToken, 'GET', `/api/engagements/${projectId}`)).members || [];
  const lead = members.find((m) => m.user.id === leadLogin.user.id);
  // From today: access starts on its start date (sprint 6), and the scripts
  // work in engagements that start later. A start before the approval is
  // the approval itself.
  await step('approve the Lead', clientToken, 'POST', `/api/engagements/${projectId}/members/${lead?.id}/approve`, {
    engagementRole: 'Lead', accessFrom: new Date().toISOString().slice(0, 10),
  });
  return firm;
}

module.exports = { bringFirm };
