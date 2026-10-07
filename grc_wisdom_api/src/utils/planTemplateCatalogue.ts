import { TemplateBody } from '../services/planTemplates';

/**
 * The platform's own plan templates (consulting engagement, sprint 3).
 *
 * Provisioned once per family: a deploy creates version 1 where the family is
 * missing and never touches a family that exists, so a version the platform
 * has since saved, or a template it has retired, stays as it is.
 *
 * ISO 27001 certification follows the path the certification walkthrough
 * describes: scope and context, gap assessment, risk assessment and
 * treatment with the Statement of Applicability, policies, controls and
 * awareness, internal audit and management review, and readiness for the
 * Stage 1 audit. The organisation decides at every step; the tasks on the
 * Provider side are what a consulting firm prepares and advises on.
 */

export interface CatalogueTemplate extends TemplateBody {
  /** Fixed, so provisioning can tell whether the family already exists. */
  familyId: string;
}

export const PLATFORM_PLAN_TEMPLATES: CatalogueTemplate[] = [
  {
    familyId: 'platform-iso27001-certification',
    name: 'ISO 27001 certification',
    description: 'Seven phases from scope to readiness for the Stage 1 audit. The organisation '
      + 'approves the scope, owns the risks and signs off readiness; a consulting firm, where '
      + 'there is one, prepares and advises.',
    engagementType: 'Certification',
    standardCode: 'ISO27001',
    phases: [
      {
        name: 'Scoping',
        durationDays: 10,
        tasks: [
          { key: 's1', name: 'Kick-off and engagement charter', side: 'Provider', durationDays: 2, weight: 1, deliverable: 'Engagement charter' },
          { key: 's2', name: 'Internal and external issues', side: 'Provider', durationDays: 4, weight: 2, dependsOnKey: 's1', clauses: ['4.1'], deliverable: 'Context register' },
          { key: 's3', name: 'Interested parties and their requirements', side: 'Provider', durationDays: 3, weight: 2, dependsOnKey: 's1', clauses: ['4.2'], deliverable: 'Interested-parties register' },
          { key: 's4', name: 'Draft the ISMS scope statement', side: 'Provider', durationDays: 3, weight: 2, dependsOnKey: 's2', clauses: ['4.3'], needsVerification: true, deliverable: 'Scope statement' },
          { key: 's5', name: 'Approve the ISMS scope', side: 'Client', durationDays: 2, weight: 1, dependsOnKey: 's4', clauses: ['4.3'] },
        ],
      },
      {
        name: 'Gap assessment',
        durationDays: 15,
        tasks: [
          { key: 'g1', name: 'Supply the asset list', side: 'Client', durationDays: 5, weight: 1, deliverable: 'Asset list' },
          { key: 'g2', name: 'Rate the management clauses', side: 'Provider', durationDays: 5, weight: 2, clauses: ['4', '5', '6', '7', '8', '9', '10'], deliverable: 'Gap register' },
          { key: 'g3', name: 'Review Annex A controls', side: 'Provider', durationDays: 5, weight: 2, dependsOnKey: 'g1', clauses: ['A.5', 'A.6', 'A.7', 'A.8'], generate: 'PerTheme' },
          { key: 'g4', name: 'Gap report', side: 'Provider', durationDays: 4, weight: 2, dependsOnKey: 'g3', needsVerification: true, deliverable: 'Gap report' },
        ],
      },
      {
        name: 'Risk assessment and treatment',
        durationDays: 20,
        tasks: [
          { key: 'r1', name: 'Agree the risk assessment method', side: 'Provider', durationDays: 3, weight: 1, clauses: ['6.1.2'], deliverable: 'Risk methodology' },
          { key: 'r2', name: 'Identify assets and risks', side: 'Client', durationDays: 7, weight: 2, dependsOnKey: 'r1', clauses: ['6.1.2', '8.2'] },
          { key: 'r3', name: 'Score the risks with their owners', side: 'Client', durationDays: 5, weight: 2, dependsOnKey: 'r2', clauses: ['6.1.2'] },
          { key: 'r4', name: 'Draft the risk treatment plan', side: 'Provider', durationDays: 4, weight: 2, dependsOnKey: 'r3', clauses: ['6.1.3', '8.3'], deliverable: 'Risk treatment plan' },
          { key: 'r5', name: 'Draft the Statement of Applicability', side: 'Provider', durationDays: 4, weight: 2, dependsOnKey: 'r4', clauses: ['6.1.3'], needsVerification: true, deliverable: 'Statement of Applicability' },
          { key: 'r6', name: 'Approve the treatment and accept residual risk', side: 'Client', durationDays: 3, weight: 1, dependsOnKey: 'r5', clauses: ['6.1.3'] },
        ],
      },
      {
        name: 'Policies',
        durationDays: 20,
        tasks: [
          { key: 'p1', name: 'Information security policy', side: 'Provider', durationDays: 5, weight: 2, clauses: ['5.2', 'A.5.1'], needsVerification: true, deliverable: 'Information security policy' },
          { key: 'p2', name: 'Topic-specific policies', side: 'Provider', durationDays: 10, weight: 3, dependsOnKey: 'p1', clauses: ['A.5'], deliverable: 'Policy set' },
          { key: 'p3', name: 'Approve and publish the policies', side: 'Client', durationDays: 5, weight: 1, dependsOnKey: 'p2', clauses: ['7.5'] },
        ],
      },
      {
        name: 'Controls',
        durationDays: 40,
        tasks: [
          { key: 'c1', name: 'Implement Annex A controls', side: 'Client', durationDays: 30, weight: 3, clauses: ['A.5', 'A.6', 'A.7', 'A.8'], generate: 'PerTheme' },
          { key: 'c2', name: 'Awareness and training', side: 'Client', durationDays: 10, weight: 1, clauses: ['7.2', '7.3', 'A.6.3'], deliverable: 'Training records' },
          { key: 'c3', name: 'Collect control evidence', side: 'Client', durationDays: 10, weight: 2, dependsOnKey: 'c1', needsVerification: true, deliverable: 'Evidence pack' },
        ],
      },
      {
        name: 'Internal audit',
        durationDays: 15,
        tasks: [
          { key: 'a1', name: 'Internal audit programme', side: 'Client', durationDays: 3, weight: 1, clauses: ['9.2'], deliverable: 'Audit programme' },
          { key: 'a2', name: 'Conduct the internal audit', side: 'Client', durationDays: 7, weight: 2, dependsOnKey: 'a1', clauses: ['9.2'], deliverable: 'Internal audit report',
            description: 'By someone independent of the implementation: not the consulting firm that built the ISMS.' },
          { key: 'a3', name: 'Management review', side: 'Client', durationDays: 3, weight: 1, dependsOnKey: 'a2', clauses: ['9.3'], deliverable: 'Management review record' },
          { key: 'a4', name: 'Corrective actions', side: 'Client', durationDays: 5, weight: 1, dependsOnKey: 'a3', clauses: ['10.2'] },
        ],
      },
      {
        name: 'Readiness',
        durationDays: 10,
        tasks: [
          { key: 'd1', name: 'Mock audit and readiness opinion', side: 'Provider', durationDays: 4, weight: 2, deliverable: 'Readiness opinion' },
          { key: 'd2', name: 'Close the readiness gaps', side: 'Client', durationDays: 4, weight: 2, dependsOnKey: 'd1' },
          { key: 'd3', name: 'Sponsor sign-off for the Stage 1 audit', side: 'Client', durationDays: 2, weight: 1, dependsOnKey: 'd2', needsVerification: true },
        ],
      },
    ],
  },
];
