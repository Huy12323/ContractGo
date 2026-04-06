import { Utils_Options_EnumsToOptions } from "@/utils/options/EnumsToOptions";

type CurrencyCode =
    | "USD"
    | "EUR"
    | "GBP"
    | "JPY"
    | "CNY"
    | "VND"
    | "KRW"
    | "SGD"
    | "THB"
    | "PHP"
    | "INR"
    | "MYR"
    | "IDR"
    | "TWD"
    | "HKD"
    | "AUD"
    | "CAD"
    | "NZD"
    | "CHF"
    | "BRL";

const Currencies: Record<CurrencyCode, { value: CurrencyCode; label: string }> = {
    AUD: { value: "AUD", label: "Australian Dollar (AUD)" },
    BRL: { value: "BRL", label: "Brazilian Real (BRL)" },
    GBP: { value: "GBP", label: "British Pound (GBP)" },
    CAD: { value: "CAD", label: "Canadian Dollar (CAD)" },
    CNY: { value: "CNY", label: "Chinese Yuan (CNY)" },
    EUR: { value: "EUR", label: "Euro (EUR)" },
    HKD: { value: "HKD", label: "Hong Kong Dollar (HKD)" },
    INR: { value: "INR", label: "Indian Rupee (INR)" },
    IDR: { value: "IDR", label: "Indonesian Rupiah (IDR)" },
    JPY: { value: "JPY", label: "Japanese Yen (JPY)" },
    MYR: { value: "MYR", label: "Malaysian Ringgit (MYR)" },
    TWD: { value: "TWD", label: "New Taiwan Dollar (TWD)" },
    NZD: { value: "NZD", label: "New Zealand Dollar (NZD)" },
    PHP: { value: "PHP", label: "Philippine Peso (PHP)" },
    SGD: { value: "SGD", label: "Singapore Dollar (SGD)" },
    KRW: { value: "KRW", label: "South Korean Won (KRW)" },
    CHF: { value: "CHF", label: "Swiss Franc (CHF)" },
    THB: { value: "THB", label: "Thai Baht (THB)" },
    USD: { value: "USD", label: "US Dollar (USD)" },
    VND: { value: "VND", label: "Vietnamese Dong (VND)" },
};

export const const_CurrenciesOptions = Utils_Options_EnumsToOptions(Currencies);
