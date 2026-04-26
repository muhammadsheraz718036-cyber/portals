export function parseDateInput(value: string): Date | null {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

export function formatDateInput(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function isWithinDateRange(
  value: string,
  fromDate: string,
  toDate: string,
): boolean {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;

  const from = parseDateInput(fromDate);
  if (from) {
    from.setHours(0, 0, 0, 0);
    if (date < from) return false;
  }

  const to = parseDateInput(toDate);
  if (to) {
    to.setHours(23, 59, 59, 999);
    if (date > to) return false;
  }

  return true;
}

export function getDateRangeLabel(fromDate: string, toDate: string): string {
  if (fromDate && toDate) return `${fromDate} to ${toDate}`;
  if (fromDate) return `From ${fromDate}`;
  if (toDate) return `Until ${toDate}`;
  return "All dates";
}
