/**
 * Localized auth/registration messages (EN + AR).
 * Prefer error codes for clients; messages remain human-readable fallbacks.
 */

export type AuthLocale = "en" | "ar";

export type AuthErrorCode =
  | "NETWORK_UNAVAILABLE"
  | "EMAIL_ALREADY_REGISTERED"
  | "INVALID_EMAIL"
  | "WEAK_PASSWORD"
  | "MISSING_FIELDS"
  | "USERNAME_TAKEN"
  | "USERNAME_INVALID"
  | "UNDERAGE"
  | "REGISTRATION_UNAVAILABLE"
  | "VERIFICATION_EMAIL_FAILED"
  | "EMAIL_QUOTA_EXCEEDED"
  | "VERIFICATION_REQUIRED"
  | "INVALID_OTP"
  | "OTP_EXPIRED"
  | "OTP_RATE_LIMIT"
  | "UNEXPECTED_ERROR";

const EN: Record<AuthErrorCode, string> = {
  NETWORK_UNAVAILABLE: "Could not connect to the internet. Check your connection and try again.",
  EMAIL_ALREADY_REGISTERED: "This email is already registered.",
  INVALID_EMAIL: "Please enter a valid email address.",
  WEAK_PASSWORD: "Password does not meet the required security conditions.",
  MISSING_FIELDS: "Please fill in all required fields.",
  USERNAME_TAKEN: "That username is already taken.",
  USERNAME_INVALID: "Username must be 3–30 characters: letters, numbers, underscore.",
  UNDERAGE: "You must be 18 or older to use Path+",
  REGISTRATION_UNAVAILABLE: "Unable to create an account right now. Please try again shortly.",
  VERIFICATION_EMAIL_FAILED: "Unable to send the verification email. Please try again later.",
  EMAIL_QUOTA_EXCEEDED: "Unable to send the verification email. Please try again later.",
  VERIFICATION_REQUIRED: "Please verify your email to finish creating your account.",
  INVALID_OTP: "Invalid verification code",
  OTP_EXPIRED: "This verification code has expired. Please request a new code.",
  OTP_RATE_LIMIT: "Please wait a minute before requesting another code.",
  UNEXPECTED_ERROR: "An unexpected error occurred. Please try again later.",
};

const AR: Record<AuthErrorCode, string> = {
  NETWORK_UNAVAILABLE: "تعذر الاتصال بالإنترنت. تحقق من اتصالك وحاول مرة أخرى.",
  EMAIL_ALREADY_REGISTERED: "هذا البريد الإلكتروني مسجل بالفعل.",
  INVALID_EMAIL: "يرجى إدخال بريد إلكتروني صحيح.",
  WEAK_PASSWORD: "كلمة المرور لا تستوفي شروط الأمان المطلوبة.",
  MISSING_FIELDS: "يرجى تعبئة جميع الحقول المطلوبة.",
  USERNAME_TAKEN: "اسم المستخدم مستخدم بالفعل.",
  USERNAME_INVALID: "يجب أن يكون اسم المستخدم من ٣–٣٠ حرفاً: أحرف وأرقام وشرطة سفلية.",
  UNDERAGE: "يجب أن يكون عمرك ١٨ سنة أو أكثر لاستخدام Path+",
  REGISTRATION_UNAVAILABLE: "تعذر إنشاء الحساب حالياً. يرجى المحاولة بعد قليل.",
  VERIFICATION_EMAIL_FAILED: "تعذر إرسال رسالة التحقق. حاول مرة أخرى لاحقاً.",
  EMAIL_QUOTA_EXCEEDED: "تعذر إرسال رسالة التحقق. حاول مرة أخرى لاحقاً.",
  VERIFICATION_REQUIRED: "يرجى التحقق من بريدك الإلكتروني لإكمال إنشاء الحساب.",
  INVALID_OTP: "رمز التحقق غير صحيح",
  OTP_EXPIRED: "انتهت صلاحية رمز التحقق. يرجى طلب رمز جديد.",
  OTP_RATE_LIMIT: "يرجى الانتظار دقيقة قبل طلب رمز آخر.",
  UNEXPECTED_ERROR: "حدث خطأ غير متوقع. يرجى المحاولة لاحقاً.",
};

export function resolveAuthLocale(header: string | undefined | null): AuthLocale {
  if (!header) return "en";
  const primary = header.split(",")[0]?.trim().toLowerCase() ?? "en";
  if (primary.startsWith("ar")) return "ar";
  return "en";
}

export function authMessage(code: AuthErrorCode, locale: AuthLocale = "en"): string {
  return (locale === "ar" ? AR : EN)[code];
}

export function newRequestId(): string {
  return `reg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
