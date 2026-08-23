"use client";

import { useState } from "react";
import styles from "./customer-portal-admin.module.css";

const DIGITS = "23456789";
const WORDS = [
  "Amber", "Anchor", "Atlas", "Bay", "Birch", "Blue", "Bridge", "Cargo",
  "Cedar", "Cloud", "Coast", "Copper", "Crane", "Creek", "Delta", "Dock",
  "Dune", "East", "Ember", "Field", "Fleet", "Forest", "Gate", "Gold",
  "Harbor", "Hill", "Iron", "Jade", "Lake", "Lane", "Lime", "Maple",
  "Mesa", "Moon", "North", "Ocean", "Olive", "Orchid", "Pine", "Port",
  "Rail", "Reef", "River", "Road", "Sage", "Sand", "Silver", "Slate",
  "South", "Spring", "Stone", "Summit", "Tide", "Timber", "Trail", "Vale",
  "Wave", "West", "Willow", "Wind", "Wood", "Yard", "Yellow", "Zinc",
];

function secureIndex(length: number) {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return values[0] % length;
}

function pick(chars: string) {
  return chars[secureIndex(chars.length)];
}

function generatePassword() {
  const words = Array.from({ length: 4 }, () => WORDS[secureIndex(WORDS.length)]);
  const digits = Array.from({ length: 8 }, () => pick(DIGITS)).join("");
  return `${words.join("-")}-${digits}!`;
}

export function CustomerPasswordField({
  label,
  required = false,
  help = "Leave blank to keep the current password.",
}: {
  label: string;
  required?: boolean;
  help?: string;
}) {
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [copied, setCopied] = useState(false);

  function createPassword() {
    setPassword(generatePassword());
    setVisible(true);
    setCopied(false);
  }

  async function copyPassword() {
    await navigator.clipboard.writeText(password);
    setCopied(true);
  }

  return (
    <div className={styles.passwordField}>
      <label className={styles.field}>
        <span>{label}</span>
        <input
          className={styles.input}
          name="password"
          type={visible ? "text" : "password"}
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
            setCopied(false);
          }}
          minLength={12}
          maxLength={128}
          required={required}
          autoComplete="new-password"
        />
      </label>
      <div className={styles.passwordControls}>
        <button className="btn btn-secondary btn-sm" type="button" onClick={createPassword}>Generate</button>
        <button
          className="btn btn-secondary btn-sm"
          type="button"
          onClick={() => setVisible((current) => !current)}
          disabled={!password}
        >
          {visible ? "Hide" : "Show"}
        </button>
        <button
          className="btn btn-secondary btn-sm"
          type="button"
          onClick={copyPassword}
          disabled={!password}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <small>{help}</small>
    </div>
  );
}
