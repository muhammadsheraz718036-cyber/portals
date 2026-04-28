import { useState } from "react";
import { Calendar as CalendarIcon } from "lucide-react";
import type { DateRange } from "react-day-picker";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  formatDateInput,
  getDateRangeLabel,
  parseDateInput,
} from "@/lib/dateFilters";
import { cn } from "@/lib/utils";

export type DateRangeValue = {
  from: string;
  to: string;
};

export function DateRangeSelector({
  value,
  onChange,
  className,
  align = "end",
  description = "Filter records by submitted date",
}: {
  value: DateRangeValue;
  onChange: (range: DateRangeValue) => void;
  className?: string;
  align?: "start" | "center" | "end";
  description?: string;
}) {
  const [open, setOpen] = useState(false);
  const selectedRange: DateRange | undefined =
    value.from || value.to
      ? {
          from: value.from ? parseDateInput(value.from) ?? undefined : undefined,
          to: value.to ? parseDateInput(value.to) ?? undefined : undefined,
        }
      : undefined;

  const applyPreset = (days: number) => {
    const to = new Date();
    const from = new Date();
    from.setDate(to.getDate() - (days - 1));
    onChange({
      from: formatDateInput(from),
      to: formatDateInput(to),
    });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn(
            "w-full justify-start gap-2 bg-background text-left font-normal sm:w-[250px]",
            !value.from && !value.to && "text-muted-foreground",
            className,
          )}
        >
          <CalendarIcon className="h-4 w-4" />
          <span className="truncate">{getDateRangeLabel(value.from, value.to)}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align={align}>
        <div className="border-b p-3">
          <p className="text-sm font-semibold text-foreground">Date Range</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {description}
          </p>
        </div>
        <div className="flex flex-col gap-3 p-3 lg:flex-row">
          <div className="grid min-w-[130px] content-start gap-2">
            <Button variant="ghost" size="sm" className="justify-start" onClick={() => applyPreset(7)}>
              Last 7 days
            </Button>
            <Button variant="ghost" size="sm" className="justify-start" onClick={() => applyPreset(30)}>
              Last 30 days
            </Button>
            <Button variant="ghost" size="sm" className="justify-start" onClick={() => applyPreset(90)}>
              Last 90 days
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="justify-start"
              onClick={() => onChange({ from: "", to: "" })}
            >
              All dates
            </Button>
          </div>
          <Calendar
            mode="range"
            selected={selectedRange}
            onSelect={(range) => {
              onChange({
                from: range?.from ? formatDateInput(range.from) : "",
                to: range?.to ? formatDateInput(range.to) : "",
              });
            }}
            numberOfMonths={2}
            initialFocus
            className="rounded-md"
          />
        </div>
        <div className="flex items-center justify-end gap-2 border-t p-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onChange({ from: "", to: "" })}
          >
            Clear
          </Button>
          <Button size="sm" onClick={() => setOpen(false)}>
            Apply
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
