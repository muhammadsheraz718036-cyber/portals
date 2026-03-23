import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { ApprovalFormField } from "@/lib/constants";

interface FormFieldInputProps {
  field: ApprovalFormField;
  value: string;
  onChange: (value: string) => void;
}

export function FormFieldInput({ field, value, onChange }: FormFieldInputProps) {
  const fieldId = `field_${field.name}`;

  switch (field.type) {
    case "text":
      return (
        <div className="space-y-2">
          <label htmlFor={fieldId} className="text-sm font-medium text-foreground">
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
          <label htmlFor={fieldId} className="text-sm font-medium text-foreground">
            {field.label}
            {field.required && <span className="text-destructive ml-1">*</span>}
          </label>
          <Input
            id={fieldId}
            type="number"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={`Enter ${field.label.toLowerCase()}`}
            required={field.required}
          />
        </div>
      );

    case "email":
      return (
        <div className="space-y-2">
          <label htmlFor={fieldId} className="text-sm font-medium text-foreground">
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
          <label htmlFor={fieldId} className="text-sm font-medium text-foreground">
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
          <label htmlFor={fieldId} className="text-sm font-medium text-foreground">
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
          <label htmlFor={fieldId} className="text-sm font-medium text-foreground">
            {field.label}
            {field.required && <span className="text-destructive ml-1">*</span>}
          </label>
          <Select value={value} onValueChange={onChange}>
            <SelectTrigger id={fieldId}>
              <SelectValue placeholder={`Select ${field.label.toLowerCase()}`} />
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

    default:
      return (
        <div className="space-y-2">
          <label htmlFor={fieldId} className="text-sm font-medium text-foreground">
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
