/**
 * A date somebody typed into a form is a calendar date, not an instant.
 *
 * `new Date('2026-10-01')` is parsed as UTC midnight, and toLocaleDateString
 * then renders that instant in the reader's own zone — so a phase a project
 * manager started on 1 October printed back as "Sep 30" for every reader west
 * of Greenwich. The plan screen shows these dates straight back to the person
 * who has just typed them, which is the worst possible place to be a day out.
 *
 * Only for columns that are genuinely calendar dates: a phase window, a task
 * due date, a project timeline. A real timestamp — when something was raised,
 * uploaded or last changed — is an instant and should keep being rendered in
 * the reader's zone, because that is the question it answers.
 *
 * The head is taken rather than the whole string because these columns come
 * back from the database as full ISO timestamps.
 */

const DATE_HEAD = /^(\d{4})-(\d{2})-(\d{2})/;

const DEFAULT_OPTIONS: Intl.DateTimeFormatOptions = { day: '2-digit', month: 'short' };

export const calendarDate = (
  iso: string | null | undefined,
  options: Intl.DateTimeFormatOptions = DEFAULT_OPTIONS,
  fallback = '—',
): string => {
  if (!iso) return fallback;
  const parts = DATE_HEAD.exec(String(iso));
  // Not a shape we recognise: render it as an instant rather than invent a day.
  const d = parts
    ? new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]))
    : new Date(String(iso));
  return Number.isNaN(d.getTime()) ? fallback : d.toLocaleDateString(undefined, options);
};

export default calendarDate;
