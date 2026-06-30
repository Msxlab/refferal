// HQ drill-in: sahip bir sirkete indiginde aktif sirket (act-as) token'i.
// Bagimsiz modul — hem api.ts hem auth.ts buradan import eder (dairesel bagimlilik olmaz).
let activeCompanyToken: string | null = null;
export function setActiveCompanyToken(token: string | null): void { activeCompanyToken = token; }
export function getActiveCompanyToken(): string | null { return activeCompanyToken; }
