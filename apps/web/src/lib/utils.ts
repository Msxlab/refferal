import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** shadcn standart yardimci: kosullu sinif birlestirme + Tailwind cakisma cozumu. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
