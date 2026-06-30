"use client";
import React from "react";

type Props = React.SelectHTMLAttributes<HTMLSelectElement> & {
  options: { value: string; label: string }[];
};

export function AutoSubmitSelect({ options, ...props }: Props) {
  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const form = e.target.closest("form") as HTMLFormElement | null;
    if (form) form.requestSubmit();
  }

  return (
    <select onChange={handleChange} {...props}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}
