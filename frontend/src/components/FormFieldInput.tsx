import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type { ApprovalFormField } from "@/lib/constants";

interface FormFieldInputProps {
  field: ApprovalFormField;
  value: string;
  onChange: (value: string) => void;
}

export function FormFieldInput({
  field,
  value,
  onChange,
}: FormFieldInputProps) {
  const fieldId = `field_${field.name}`;

  switch (field.type) {
    case "text":
      return (
        <div className="space-y-2">
          <label
            htmlFor={fieldId}
            className="text-sm font-medium text-foreground"
          >
            {field.label}
            {field.required && <span className="text-destructive ml-1">*</span>}
          </label>
          <Input
            id={fieldId}
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={`Enter ${field.label.toLowerCase()}`}
            required={field.required}
          />
        </div>
      );

    case "number":
      return (
        <div className="space-y-2">
          <label
            htmlFor={fieldId}
            className="text-sm font-medium text-foreground"
          >
            {field.label}
            {field.required && <span className="text-destructive ml-1">*</span>}
          </label>
          <Input
            id={fieldId}
            type="number"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            inputMode="decimal"
            onFocus={(e) => {
              // Auto-clear common default values when user focuses
              const currentValue = e.target.value;
              if (
                currentValue === "0" ||
                currentValue === "000" ||
                currentValue === "0000" ||
                currentValue === "00000"
              ) {
                onChange("");
              }
            }}
            placeholder={`Enter ${field.label.toLowerCase()}`}
            required={field.required}
          />
        </div>
      );

    case "email":
      return (
        <div className="space-y-2">
          <label
            htmlFor={fieldId}
            className="text-sm font-medium text-foreground"
          >
            {field.label}
            {field.required && <span className="text-destructive ml-1">*</span>}
          </label>
          <Input
            id={fieldId}
            type="email"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={`Enter ${field.label.toLowerCase()}`}
            required={field.required}
          />
        </div>
      );

    case "date":
      return (
        <div className="space-y-2">
          <label
            htmlFor={fieldId}
            className="text-sm font-medium text-foreground"
          >
            {field.label}
            {field.required && <span className="text-destructive ml-1">*</span>}
          </label>
          <Input
            id={fieldId}
            type="date"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            required={field.required}
          />
        </div>
      );

    case "textarea":
      return (
        <div className="space-y-2">
          <label
            htmlFor={fieldId}
            className="text-sm font-medium text-foreground"
          >
            {field.label}
            {field.required && <span className="text-destructive ml-1">*</span>}
          </label>
          <Textarea
            id={fieldId}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={`Enter ${field.label.toLowerCase()}`}
            required={field.required}
            rows={4}
          />
        </div>
      );

    case "select":
      return (
        <div className="space-y-2">
          <label
            htmlFor={fieldId}
            className="text-sm font-medium text-foreground"
          >
            {field.label}
            {field.required && <span className="text-destructive ml-1">*</span>}
          </label>
          <Select value={value} onValueChange={onChange}>
            <SelectTrigger id={fieldId}>
              <SelectValue
                placeholder={`Select ${field.label.toLowerCase()}`}
              />
            </SelectTrigger>
            <SelectContent>
              {field.options?.map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      );

    case "radio":
      return (
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">
            {field.label}
            {field.required && <span className="text-destructive ml-1">*</span>}
          </label>
          <RadioGroup value={value} onValueChange={onChange}>
            {field.options?.map((option) => (
              <div key={option} className="flex items-center space-x-2">
                <RadioGroupItem value={option} id={`${fieldId}_${option}`} />
                <label
                  htmlFor={`${fieldId}_${option}`}
                  className="text-sm font-normal cursor-pointer"
                >
                  {option}
                </label>
              </div>
            ))}
          </RadioGroup>
        </div>
      );

    case "checkbox":
      return (
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">
            {field.label}
            {field.required && <span className="text-destructive ml-1">*</span>}
          </label>
          <div className="flex items-center space-x-2">
            <Checkbox
              id={fieldId}
              checked={value === "true"}
              onCheckedChange={(checked) => onChange(checked ? "true" : "")}
            />
            <label
              htmlFor={fieldId}
              className="text-sm font-normal cursor-pointer"
            >
              {field.label} checkbox
            </label>
          </div>
        </div>
      );

    default:
      return (
        <div className="space-y-2">
          <label
            htmlFor={fieldId}
            className="text-sm font-medium text-foreground"
          >
            {field.label}
            {field.required && <span className="text-destructive ml-1">*</span>}
          </label>
          <Input
            id={fieldId}
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={`Enter ${field.label.toLowerCase()}`}
            required={field.required}
          />
        </div>
      );
  }
}
