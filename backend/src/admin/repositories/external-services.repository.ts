import { supabaseAdmin } from "../../supabase";

export type ExternalServiceId = "email" | "supabase" | "push" | "google_places";

export type ExternalServiceRow = {
  id: string;
  service: ExternalServiceId;
  enabled: boolean;
  configuration: Record<string, unknown>;
  encrypted_secrets: string | null;
  secret_fields: string[];
  last_test_at: string | null;
  last_test_ok: boolean | null;
  last_test_message: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

export const externalServicesRepository = {
  async list(): Promise<ExternalServiceRow[]> {
    const { data, error } = await supabaseAdmin
      .from("external_service_settings")
      .select("*")
      .order("service", { ascending: true });
    if (error) throw error;
    return (data ?? []) as ExternalServiceRow[];
  },

  async get(service: ExternalServiceId): Promise<ExternalServiceRow | null> {
    const { data, error } = await supabaseAdmin
      .from("external_service_settings")
      .select("*")
      .eq("service", service)
      .maybeSingle();
    if (error) throw error;
    return (data as ExternalServiceRow) ?? null;
  },

  async upsert(input: {
    service: ExternalServiceId;
    enabled?: boolean;
    configuration?: Record<string, unknown>;
    encrypted_secrets?: string | null;
    secret_fields?: string[];
    updated_by?: string | null;
  }): Promise<ExternalServiceRow> {
    const existing = await this.get(input.service);
    const payload: Record<string, unknown> = {
      service: input.service,
      updated_at: new Date().toISOString(),
      updated_by: input.updated_by ?? null,
    };
    if (input.enabled !== undefined) payload.enabled = input.enabled;
    if (input.configuration !== undefined) payload.configuration = input.configuration;
    if (input.encrypted_secrets !== undefined) {
      payload.encrypted_secrets = input.encrypted_secrets;
    }
    if (input.secret_fields !== undefined) payload.secret_fields = input.secret_fields;

    if (existing) {
      const { data, error } = await supabaseAdmin
        .from("external_service_settings")
        .update(payload)
        .eq("service", input.service)
        .select("*")
        .single();
      if (error) throw error;
      return data as ExternalServiceRow;
    }

    const { data, error } = await supabaseAdmin
      .from("external_service_settings")
      .insert({
        enabled: true,
        configuration: {},
        secret_fields: [],
        ...payload,
      })
      .select("*")
      .single();
    if (error) throw error;
    return data as ExternalServiceRow;
  },

  async recordTest(
    service: ExternalServiceId,
    result: { ok: boolean; message: string }
  ): Promise<void> {
    const { error } = await supabaseAdmin
      .from("external_service_settings")
      .update({
        last_test_at: new Date().toISOString(),
        last_test_ok: result.ok,
        last_test_message: result.message.slice(0, 500),
        updated_at: new Date().toISOString(),
      })
      .eq("service", service);
    if (error) {
      // Row may not exist yet — ignore non-fatal
      console.warn("[external-services] recordTest:", error.message);
    }
  },
};
