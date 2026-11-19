// Public client configuration only. Never place privileged keys in this file.
export const SUPABASE_DEFAULTS = Object.freeze({
  "url": "https://chuxwrggnerashtnchnz.supabase.co",
  "publishableKey": "sb_publishable_vUg0LbiKAEMaUJtI_QPpJQ_u--I6tL4"
});

export function validateSupabaseConfig(value, required = true) {
  if (!value || typeof value.url !== "string" || typeof value.publishableKey !== "string") throw new Error("同步设置格式不正确");
  const url = value.url.trim(), publishableKey = value.publishableKey.trim();
  if (required && (!url || !publishableKey)) throw new Error("请输入 Supabase 项目地址和 publishable key");
  if (url) {
    let parsed;
    try {parsed = new URL(url);} catch {throw new Error("Supabase 地址必须是 HTTPS 项目地址");}
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== "/") throw new Error("Supabase 地址必须是 HTTPS 项目地址");
  }
  if (publishableKey && !/^sb_publishable_[A-Za-z0-9_-]+$/.test(publishableKey)) throw new Error("请使用 Supabase publishable key");
  return {url: url ? new URL(url).origin : "", publishableKey};
}
