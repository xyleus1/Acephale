import crypto from "crypto";

function scryptAsync(password: string, salt: string) {
  return new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey as Buffer);
    });
  });
}

export async function hashPassword(password: string) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = (await scryptAsync(password, salt)).toString("hex");
  return `${salt}:${hash}`;
}

export async function verifyPassword(password: string, hashed: string) {
  const [salt, storedHash] = hashed.split(":");
  if (!salt || !storedHash) return false;
  const derived = (await scryptAsync(password, salt)).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(storedHash, "hex"), Buffer.from(derived, "hex"));
}

