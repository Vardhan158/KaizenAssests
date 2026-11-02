import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";

type PasswordInputProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  name?: string;
  autoComplete?: string;
  className?: string;
};

export function PasswordInput({ label, value, onChange, required, minLength, maxLength, name, autoComplete, className = "" }: PasswordInputProps) {
  const [visible, setVisible] = useState(false);

  return (
    <label className={`block space-y-1.5 text-sm font-medium ${className}`}>
      {label}
      <span className="relative block">
        <input
          name={name}
          required={required}
          minLength={minLength}
          maxLength={maxLength}
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="h-10 w-full rounded-md border bg-background px-3 pr-10 font-normal"
        />
        <button
          type="button"
          aria-label={visible ? "Hide password" : "Show password"}
          title={visible ? "Hide password" : "Show password"}
          onClick={() => setVisible((current) => !current)}
          className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-md text-slate-500 transition hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
        >
          {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </span>
    </label>
  );
}
