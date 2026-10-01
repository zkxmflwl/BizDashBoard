--
-- PostgreSQL database dump
--


-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--



--
-- Name: set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


--
-- Name: validate_sector_project_progress(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."validate_sector_project_progress"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NEW.progress =< 0 OR NEW.progress > 100 THEN
    RAISE EXCEPTION 'progress must be between 0 and 100';
  END IF;
  RETURN NEW;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = "heap";

--
-- Name: asset_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."asset_types" (
    "asset_type_code" "text" NOT NULL,
    "major_category" "text" NOT NULL,
    "sub_category" "text" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "asset_types_major_category_check" CHECK (("major_category" = ANY (ARRAY['유형자산'::"text", '무형자산'::"text"])))
);


--
-- Name: business_projects; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."business_projects" (
    "id" bigint NOT NULL,
    "project_name" "text" NOT NULL,
    "project_summary" "text",
    "department_code" "text" NOT NULL,
    "client_name" "text",
    "project_status" "text" NOT NULL,
    "sales_schedule_note" "text",
    "category" "text",
    "base_date" "date",
    "order_date" "date",
    "start_date" "date",
    "end_date" "date",
    "sales_amount" numeric(18,2) DEFAULT 0 NOT NULL,
    "purchase_amount" numeric(18,2) DEFAULT 0 NOT NULL,
    "note" "text",
    "effort" "text",
    "last_modified_by_auth_user_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "sort_order" integer DEFAULT 100,
    "visible" boolean DEFAULT true NOT NULL,
    CONSTRAINT "business_projects_project_status_check" CHECK (("project_status" = ANY (ARRAY['기회 식별'::"text", '영업 중'::"text", '수주 완료'::"text", '프로젝트 중'::"text", '프로젝트 완료'::"text", '영업 종결'::"text", '기타'::"text", '비활성'::"text"])))
);


--
-- Name: business_projects_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE "public"."business_projects" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."business_projects_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: dash_users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."dash_users" (
    "role_code" "text" DEFAULT 'VIEWER'::"text" NOT NULL,
    "user_name" "text" NOT NULL,
    "department_code" "text",
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "auth_user_id" "uuid" NOT NULL,
    "user_email" "text" NOT NULL,
    "must_change_password" boolean DEFAULT true NOT NULL,
    CONSTRAINT "users_role_code_check" CHECK (("role_code" = ANY (ARRAY['ADMIN'::"text", 'MANAGER'::"text", 'VIEWER'::"text"])))
);


--
-- Name: department_sales_summary; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."department_sales_summary" (
    "id" bigint NOT NULL,
    "department_code" "text" NOT NULL,
    "month_key" "text" NOT NULL,
    "total_headcount" integer DEFAULT 0 NOT NULL,
    "sales_amount" numeric(18,2) DEFAULT 0 NOT NULL,
    "purchase_amount" numeric(18,2) DEFAULT 0 NOT NULL,
    "note" "text",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_modified_by_auth_user_id" "uuid",
    "headcount_note" "text",
    "deferred_sales" numeric,
    "deferred_purchase" numeric,
    CONSTRAINT "department_sales_summary_month_key_check" CHECK (("month_key" ~ '^\d{4}-\d{2}$'::"text")),
    CONSTRAINT "department_sales_summary_total_headcount_check" CHECK (("total_headcount" >= 0))
);


--
-- Name: department_sales_summary_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE "public"."department_sales_summary" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."department_sales_summary_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: departments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."departments" (
    "department_code" "text" NOT NULL,
    "department_name" "text" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "sector_code" "text",
    "sector_name" "text",
    "sort_order" integer
);


--
-- Name: intangible_assets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."intangible_assets" (
    "id" bigint NOT NULL,
    "license_name" "text" NOT NULL,
    "vendor_name" "text",
    "quantity" integer DEFAULT 0 NOT NULL,
    "department_code" "text",
    "start_date" "date",
    "expiry_date" "date",
    "note" "text",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "asset_type_code" "text",
    "last_modified_by_auth_user_id" "uuid",
    CONSTRAINT "intangible_assets_quantity_check" CHECK (("quantity" >= 0))
);


--
-- Name: intangible_assets_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE "public"."intangible_assets" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."intangible_assets_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: sector_project; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."sector_project" (
    "id" bigint NOT NULL,
    "sector_project_name" "text" NOT NULL,
    "sector_code" "text" NOT NULL,
    "department_code" "text" NOT NULL,
    "user_name" "text",
    "progress" integer DEFAULT 0 NOT NULL,
    "note" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: sector_project_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE "public"."sector_project" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."sector_project_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: tangible_assets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."tangible_assets" (
    "id" bigint NOT NULL,
    "asset_no" "text",
    "department_code" "text",
    "asset_type_code" "text",
    "manufacturer" "text",
    "model_name" "text",
    "serial_no" "text",
    "cpu_spec" "text",
    "mem_spec" "text",
    "hdd_spec" "text",
    "ssd_spec" "text",
    "screen_size" "text",
    "os_name" "text",
    "purpose" "text",
    "usage" "text",
    "purchase_date" "date",
    "issued_date" "date",
    "note" "text",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_modified_by_auth_user_id" "uuid"
);


--
-- Name: tangible_assets_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE "public"."tangible_assets" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."tangible_assets_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: asset_types asset_types_major_category_sub_category_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."asset_types"
    ADD CONSTRAINT "asset_types_major_category_sub_category_key" UNIQUE ("major_category", "sub_category");


--
-- Name: asset_types asset_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."asset_types"
    ADD CONSTRAINT "asset_types_pkey" PRIMARY KEY ("asset_type_code");


--
-- Name: business_projects business_projects_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."business_projects"
    ADD CONSTRAINT "business_projects_pkey" PRIMARY KEY ("id");


--
-- Name: dash_users dash_users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."dash_users"
    ADD CONSTRAINT "dash_users_pkey" PRIMARY KEY ("auth_user_id");


--
-- Name: department_sales_summary department_sales_summary_department_code_month_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."department_sales_summary"
    ADD CONSTRAINT "department_sales_summary_department_code_month_key_key" UNIQUE ("department_code", "month_key");


--
-- Name: department_sales_summary department_sales_summary_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."department_sales_summary"
    ADD CONSTRAINT "department_sales_summary_pkey" PRIMARY KEY ("id");


--
-- Name: departments departments_department_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."departments"
    ADD CONSTRAINT "departments_department_code_key" UNIQUE ("department_code");


--
-- Name: departments departments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."departments"
    ADD CONSTRAINT "departments_pkey" PRIMARY KEY ("department_code");


--
-- Name: intangible_assets intangible_assets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."intangible_assets"
    ADD CONSTRAINT "intangible_assets_pkey" PRIMARY KEY ("id");


--
-- Name: sector_project sector_project_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."sector_project"
    ADD CONSTRAINT "sector_project_pkey" PRIMARY KEY ("id");


--
-- Name: tangible_assets tangible_assets_asset_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."tangible_assets"
    ADD CONSTRAINT "tangible_assets_asset_no_key" UNIQUE ("asset_no");


--
-- Name: tangible_assets tangible_assets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."tangible_assets"
    ADD CONSTRAINT "tangible_assets_pkey" PRIMARY KEY ("id");


--
-- Name: idx_business_projects_base_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_business_projects_base_date" ON "public"."business_projects" USING "btree" ("base_date");


--
-- Name: idx_business_projects_department_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_business_projects_department_code" ON "public"."business_projects" USING "btree" ("department_code");


--
-- Name: idx_business_projects_end_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_business_projects_end_date" ON "public"."business_projects" USING "btree" ("end_date");


--
-- Name: idx_business_projects_order_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_business_projects_order_date" ON "public"."business_projects" USING "btree" ("order_date");


--
-- Name: idx_business_projects_project_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_business_projects_project_status" ON "public"."business_projects" USING "btree" ("project_status");


--
-- Name: idx_business_projects_start_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_business_projects_start_date" ON "public"."business_projects" USING "btree" ("start_date");


--
-- Name: idx_department_sales_summary_month_key; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_department_sales_summary_month_key" ON "public"."department_sales_summary" USING "btree" ("month_key");


--
-- Name: idx_intangible_assets_department_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_intangible_assets_department_code" ON "public"."intangible_assets" USING "btree" ("department_code");


--
-- Name: idx_intangible_assets_expiry_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_intangible_assets_expiry_date" ON "public"."intangible_assets" USING "btree" ("expiry_date");


--
-- Name: idx_tangible_assets_asset_type_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_tangible_assets_asset_type_code" ON "public"."tangible_assets" USING "btree" ("asset_type_code");


--
-- Name: idx_tangible_assets_department_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_tangible_assets_department_code" ON "public"."tangible_assets" USING "btree" ("department_code");


--
-- Name: idx_tangible_assets_serial_no; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_tangible_assets_serial_no" ON "public"."tangible_assets" USING "btree" ("serial_no");


--
-- Name: ux_dash_users_user_email; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "ux_dash_users_user_email" ON "public"."dash_users" USING "btree" ("user_email");


--
-- Name: asset_types trg_asset_types_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "trg_asset_types_updated_at" BEFORE UPDATE ON "public"."asset_types" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();


--
-- Name: business_projects trg_business_projects_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "trg_business_projects_updated_at" BEFORE UPDATE ON "public"."business_projects" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();


--
-- Name: department_sales_summary trg_department_sales_summary_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "trg_department_sales_summary_updated_at" BEFORE UPDATE ON "public"."department_sales_summary" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();


--
-- Name: departments trg_departments_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "trg_departments_updated_at" BEFORE UPDATE ON "public"."departments" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();


--
-- Name: intangible_assets trg_intangible_assets_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "trg_intangible_assets_updated_at" BEFORE UPDATE ON "public"."intangible_assets" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();


--
-- Name: tangible_assets trg_tangible_assets_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "trg_tangible_assets_updated_at" BEFORE UPDATE ON "public"."tangible_assets" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();


--
-- Name: dash_users trg_users_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "trg_users_updated_at" BEFORE UPDATE ON "public"."dash_users" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();


--
-- Name: business_projects business_projects_department_code_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."business_projects"
    ADD CONSTRAINT "business_projects_department_code_fkey" FOREIGN KEY ("department_code") REFERENCES "public"."departments"("department_code") ON UPDATE CASCADE;


--
-- Name: business_projects business_projects_last_modified_by_auth_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."business_projects"
    ADD CONSTRAINT "business_projects_last_modified_by_auth_user_id_fkey" FOREIGN KEY ("last_modified_by_auth_user_id") REFERENCES "public"."dash_users"("auth_user_id");


--
-- Name: dash_users dash_users_auth_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."dash_users"
    ADD CONSTRAINT "dash_users_auth_user_id_fkey" FOREIGN KEY ("auth_user_id") REFERENCES "auth"."users"("id");


--
-- Name: department_sales_summary department_sales_summary_department_code_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."department_sales_summary"
    ADD CONSTRAINT "department_sales_summary_department_code_fkey" FOREIGN KEY ("department_code") REFERENCES "public"."departments"("department_code") ON UPDATE CASCADE;


--
-- Name: department_sales_summary department_sales_summary_last_modified_by_auth_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."department_sales_summary"
    ADD CONSTRAINT "department_sales_summary_last_modified_by_auth_user_id_fkey" FOREIGN KEY ("last_modified_by_auth_user_id") REFERENCES "public"."dash_users"("auth_user_id");


--
-- Name: intangible_assets intangible_assets_asset_type_code_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."intangible_assets"
    ADD CONSTRAINT "intangible_assets_asset_type_code_fkey" FOREIGN KEY ("asset_type_code") REFERENCES "public"."asset_types"("asset_type_code");


--
-- Name: intangible_assets intangible_assets_department_code_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."intangible_assets"
    ADD CONSTRAINT "intangible_assets_department_code_fkey" FOREIGN KEY ("department_code") REFERENCES "public"."departments"("department_code") ON UPDATE CASCADE;


--
-- Name: intangible_assets intangible_assets_last_modified_by_auth_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."intangible_assets"
    ADD CONSTRAINT "intangible_assets_last_modified_by_auth_user_id_fkey" FOREIGN KEY ("last_modified_by_auth_user_id") REFERENCES "public"."dash_users"("auth_user_id");


--
-- Name: sector_project sector_project_department_code_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."sector_project"
    ADD CONSTRAINT "sector_project_department_code_fkey" FOREIGN KEY ("department_code") REFERENCES "public"."departments"("department_code") ON UPDATE CASCADE;


--
-- Name: tangible_assets tangible_assets_asset_type_code_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."tangible_assets"
    ADD CONSTRAINT "tangible_assets_asset_type_code_fkey" FOREIGN KEY ("asset_type_code") REFERENCES "public"."asset_types"("asset_type_code");


--
-- Name: tangible_assets tangible_assets_department_code_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."tangible_assets"
    ADD CONSTRAINT "tangible_assets_department_code_fkey" FOREIGN KEY ("department_code") REFERENCES "public"."departments"("department_code") ON UPDATE CASCADE;


--
-- Name: tangible_assets tangible_assets_last_modified_by_auth_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."tangible_assets"
    ADD CONSTRAINT "tangible_assets_last_modified_by_auth_user_id_fkey" FOREIGN KEY ("last_modified_by_auth_user_id") REFERENCES "public"."dash_users"("auth_user_id");


--
-- Name: dash_users users_department_code_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."dash_users"
    ADD CONSTRAINT "users_department_code_fkey" FOREIGN KEY ("department_code") REFERENCES "public"."departments"("department_code") ON UPDATE CASCADE;


--
-- Name: asset_types; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."asset_types" ENABLE ROW LEVEL SECURITY;

--
-- Name: asset_types asset_types_select_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "asset_types_select_authenticated" ON "public"."asset_types" FOR SELECT TO "authenticated" USING (("is_active" = true));


--
-- Name: sector_project auth_delete_sector_project; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "auth_delete_sector_project" ON "public"."sector_project" FOR DELETE TO "authenticated" USING (true);


--
-- Name: sector_project auth_insert_sector_project; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "auth_insert_sector_project" ON "public"."sector_project" FOR INSERT TO "authenticated" WITH CHECK (true);


--
-- Name: sector_project auth_select_sector_project; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "auth_select_sector_project" ON "public"."sector_project" FOR SELECT TO "authenticated" USING (true);


--
-- Name: sector_project auth_update_sector_project; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "auth_update_sector_project" ON "public"."sector_project" FOR UPDATE TO "authenticated" USING (true);


--
-- Name: business_projects authenticated full access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "authenticated full access" ON "public"."business_projects" TO "authenticated" USING (true) WITH CHECK (true);


--
-- Name: department_sales_summary authenticated full access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "authenticated full access" ON "public"."department_sales_summary" TO "authenticated" USING (true) WITH CHECK (true);


--
-- Name: intangible_assets authenticated full access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "authenticated full access" ON "public"."intangible_assets" TO "authenticated" USING (true) WITH CHECK (true);


--
-- Name: tangible_assets authenticated full access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "authenticated full access" ON "public"."tangible_assets" TO "authenticated" USING (true) WITH CHECK (true);


--
-- Name: business_projects; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."business_projects" ENABLE ROW LEVEL SECURITY;

--
-- Name: dash_users; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."dash_users" ENABLE ROW LEVEL SECURITY;

--
-- Name: dash_users dash_users_select_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "dash_users_select_authenticated" ON "public"."dash_users" FOR SELECT TO "authenticated" USING (true);


--
-- Name: dash_users dash_users_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "dash_users_select_own" ON "public"."dash_users" FOR SELECT TO "authenticated" USING (((( SELECT "auth"."uid"() AS "uid") = "auth_user_id") AND ("is_active" = true)));


--
-- Name: dash_users dash_users_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "dash_users_update_own" ON "public"."dash_users" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = "auth_user_id")) WITH CHECK (("auth"."uid"() = "auth_user_id"));


--
-- Name: department_sales_summary; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."department_sales_summary" ENABLE ROW LEVEL SECURITY;

--
-- Name: departments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."departments" ENABLE ROW LEVEL SECURITY;

--
-- Name: departments departments_delete_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "departments_delete_authenticated" ON "public"."departments" FOR DELETE TO "authenticated" USING (true);


--
-- Name: departments departments_insert_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "departments_insert_authenticated" ON "public"."departments" FOR INSERT TO "authenticated" WITH CHECK (true);


--
-- Name: departments departments_select_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "departments_select_authenticated" ON "public"."departments" FOR SELECT TO "authenticated" USING (("is_active" = true));


--
-- Name: departments departments_update_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "departments_update_authenticated" ON "public"."departments" FOR UPDATE TO "authenticated" USING (true) WITH CHECK (true);


--
-- Name: intangible_assets; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."intangible_assets" ENABLE ROW LEVEL SECURITY;

--
-- Name: sector_project; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."sector_project" ENABLE ROW LEVEL SECURITY;

--
-- Name: tangible_assets; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."tangible_assets" ENABLE ROW LEVEL SECURITY;

--
-- Name: SCHEMA "public"; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";


--
-- Name: FUNCTION "set_updated_at"(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "service_role";


--
-- Name: FUNCTION "validate_sector_project_progress"(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION "public"."validate_sector_project_progress"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."validate_sector_project_progress"() TO "service_role";


--
-- Name: TABLE "asset_types"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE "public"."asset_types" TO "anon";
GRANT ALL ON TABLE "public"."asset_types" TO "authenticated";
GRANT ALL ON TABLE "public"."asset_types" TO "service_role";


--
-- Name: TABLE "business_projects"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE "public"."business_projects" TO "anon";
GRANT ALL ON TABLE "public"."business_projects" TO "authenticated";
GRANT ALL ON TABLE "public"."business_projects" TO "service_role";


--
-- Name: SEQUENCE "business_projects_id_seq"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE "public"."business_projects_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."business_projects_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."business_projects_id_seq" TO "service_role";


--
-- Name: TABLE "dash_users"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE "public"."dash_users" TO "anon";
GRANT ALL ON TABLE "public"."dash_users" TO "authenticated";
GRANT ALL ON TABLE "public"."dash_users" TO "service_role";


--
-- Name: TABLE "department_sales_summary"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE "public"."department_sales_summary" TO "anon";
GRANT ALL ON TABLE "public"."department_sales_summary" TO "authenticated";
GRANT ALL ON TABLE "public"."department_sales_summary" TO "service_role";


--
-- Name: SEQUENCE "department_sales_summary_id_seq"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE "public"."department_sales_summary_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."department_sales_summary_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."department_sales_summary_id_seq" TO "service_role";


--
-- Name: TABLE "departments"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE "public"."departments" TO "anon";
GRANT ALL ON TABLE "public"."departments" TO "authenticated";
GRANT ALL ON TABLE "public"."departments" TO "service_role";


--
-- Name: TABLE "intangible_assets"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE "public"."intangible_assets" TO "anon";
GRANT ALL ON TABLE "public"."intangible_assets" TO "authenticated";
GRANT ALL ON TABLE "public"."intangible_assets" TO "service_role";


--
-- Name: SEQUENCE "intangible_assets_id_seq"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE "public"."intangible_assets_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."intangible_assets_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."intangible_assets_id_seq" TO "service_role";


--
-- Name: TABLE "sector_project"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE "public"."sector_project" TO "anon";
GRANT ALL ON TABLE "public"."sector_project" TO "authenticated";
GRANT ALL ON TABLE "public"."sector_project" TO "service_role";


--
-- Name: SEQUENCE "sector_project_id_seq"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE "public"."sector_project_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."sector_project_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."sector_project_id_seq" TO "service_role";


--
-- Name: TABLE "tangible_assets"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE "public"."tangible_assets" TO "anon";
GRANT ALL ON TABLE "public"."tangible_assets" TO "authenticated";
GRANT ALL ON TABLE "public"."tangible_assets" TO "service_role";


--
-- Name: SEQUENCE "tangible_assets_id_seq"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE "public"."tangible_assets_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."tangible_assets_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."tangible_assets_id_seq" TO "service_role";


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--



--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--



--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--



--
-- PostgreSQL database dump complete
--


