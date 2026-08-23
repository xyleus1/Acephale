"use client";

import { useState } from "react";
import styles from "./customer-portal-admin.module.css";

const PASSWORD_LENGTH = 20;
const LOWER = "abcdefghijkmnopqrstuvwxyz";
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const DIGITS = "23456789";
const SYMBOLS = "!@#$%";
const ALL = `${LOWER}${UPPER}${DIGITS}${SYMBOLS}`;

function secureIndex(length: number) {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return values[0] % length;
}

function pick(chars: string) {
  return chars[secureIndex(chars.length)];
}

function generatePassword() {
  const characters = [pick(LOWER), pick(UPPER), pick(DIGITS), pick(SYMBOLS)];
  while (characters.length < PASSWORD_LENGTH) characters.push(pick(ALL));
  for (let index = characters.length - 1; index > 0; index -= 1) {
    const swapIndex = secureIndex(index + 1);
    [characters[index], characters[swapIndex]] = [characters[swapIndex], characters[index]];
  }
  return characters.join("");
}

export function CustomerPasswordField({
  label,
  required = false,
  help = "Copy it before saving. Derya stores only a secure hash.",
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
