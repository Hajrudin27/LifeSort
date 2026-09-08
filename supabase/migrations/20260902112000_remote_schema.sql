SET local check_function_bodies = off;
CREATE TABLE "public"."admin_users" (
  "id"         uuid                     NOT NULL,
  "role"       text                     NOT NULL,
  "full_name"  text                     NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "admin_users_pkey" PRIMARY KEY (id),
  CONSTRAINT "admin_users_role_check" CHECK ((role = ANY (ARRAY['owner'::text, 'editor'::text, 'support'::text])))
);
ALTER TABLE "public"."admin_users"
  ENABLE ROW LEVEL SECURITY;
CREATE TABLE "public"."categories" (
  "id"          text                     NOT NULL,
  "user_id"     uuid                     NOT NULL,
  "is_built_in" boolean                  NOT NULL DEFAULT false,
  "created_at"  timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "categories_pkey" PRIMARY KEY (user_id, id)
);
ALTER TABLE "public"."categories"
  ENABLE ROW LEVEL SECURITY;
CREATE TABLE "public"."cv_education" (
  "id"             text NOT NULL,
  "user_id"        uuid NOT NULL,
  "school"         text NOT NULL,
  "degree"         text NOT NULL,
  "field_of_study" text,
  "start_date"     text NOT NULL,
  "end_date"       text,
  "description"    text,
  CONSTRAINT "cv_education_pkey" PRIMARY KEY (user_id, id)
);
ALTER TABLE "public"."cv_education"
  ENABLE ROW LEVEL SECURITY;
CREATE TABLE "public"."cv_experience" (
  "id"          text NOT NULL,
  "user_id"     uuid NOT NULL,
  "company"     text NOT NULL,
  "position"    text NOT NULL,
  "start_date"  text NOT NULL,
  "end_date"    text,
  "description" text,
  CONSTRAINT "cv_experience_pkey" PRIMARY KEY (user_id, id)
);
ALTER TABLE "public"."cv_experience"
  ENABLE ROW LEVEL SECURITY;
CREATE TABLE "public"."cv_languages" (
  "id"          text NOT NULL,
  "user_id"     uuid NOT NULL,
  "name"        text NOT NULL,
  "proficiency" text NOT NULL,
  CONSTRAINT "cv_languages_pkey" PRIMARY KEY (user_id, id)
);
ALTER TABLE "public"."cv_languages"
  ENABLE ROW LEVEL SECURITY;
CREATE TABLE "public"."cv_personal_info" (
  "user_id"    uuid                     NOT NULL,
  "full_name"  text                     NOT NULL DEFAULT ''::text,
  "job_title"  text,
  "email"      text,
  "phone"      text,
  "location"   text,
  "linkedin"   text,
  "website"    text,
  "summary"    text,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "cv_personal_info_pkey" PRIMARY KEY (user_id)
);
ALTER TABLE "public"."cv_personal_info"
  ENABLE ROW LEVEL SECURITY;
CREATE TABLE "public"."cv_versions" (
  "id"             text                     NOT NULL,
  "user_id"        uuid                     NOT NULL,
  "name"           text                     NOT NULL,
  "theme"          text                     NOT NULL,
  "experience_ids" jsonb                    NOT NULL DEFAULT '[]'::jsonb,
  "education_ids"  jsonb                    NOT NULL DEFAULT '[]'::jsonb,
  "language_ids"   jsonb                    NOT NULL DEFAULT '[]'::jsonb,
  "skill_ids"      jsonb                    NOT NULL DEFAULT '[]'::jsonb,
  "created_at"     timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "cv_versions_pkey" PRIMARY KEY (user_id, id)
);
ALTER TABLE "public"."cv_versions"
  ENABLE ROW LEVEL SECURITY;
CREATE TABLE "public"."cycle_settings" (
  "user_id"              uuid                     NOT NULL,
  "avg_cycle_length"     integer                  NOT NULL DEFAULT 28,
  "luteal_phase_length"  integer                  NOT NULL DEFAULT 14,
  "reminder_enabled"     boolean                  NOT NULL DEFAULT false,
  "reminder_days_before" integer                  NOT NULL DEFAULT 1,
  "updated_at"           timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "cycle_settings_pkey" PRIMARY KEY (user_id)
);
ALTER TABLE "public"."cycle_settings"
  ENABLE ROW LEVEL SECURITY;
CREATE TABLE "public"."cycles" (
  "id"         text                     NOT NULL,
  "user_id"    uuid                     NOT NULL,
  "start_date" date                     NOT NULL,
  "end_date"   date,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "cycles_pkey" PRIMARY KEY (user_id, id)
);
ALTER TABLE "public"."cycles"
  ENABLE ROW LEVEL SECURITY;
CREATE TABLE "public"."expense_category_budgets" (
  "user_id"       uuid    NOT NULL,
  "category"      text    NOT NULL,
  "monthly_limit" numeric NOT NULL,
  CONSTRAINT "expense_category_budgets_pkey" PRIMARY KEY (user_id, category)
);
ALTER TABLE "public"."expense_category_budgets"
  ENABLE ROW LEVEL SECURITY;
CREATE TABLE "public"."expenses" (
  "id"                text                     NOT NULL,
  "user_id"           uuid                     NOT NULL,
  "series_id"         text,
  "is_recurring"      boolean                  NOT NULL DEFAULT false,
  "name"              text                     NOT NULL,
  "amount"            numeric                  NOT NULL,
  "category"          text                     NOT NULL,
  "next_payment_date" date                     NOT NULL,
  "created_at"        timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "expenses_pkey" PRIMARY KEY (user_id, id)
);
ALTER TABLE "public"."expenses"
  ENABLE ROW LEVEL SECURITY;
CREATE TABLE "public"."food_monthly_budget" (
  "user_id"   uuid    NOT NULL,
  "month_key" text    NOT NULL,
  "amount"    numeric NOT NULL,
  CONSTRAINT "food_monthly_budget_pkey" PRIMARY KEY (user_id, month_key)
);
ALTER TABLE "public"."food_monthly_budget"
  ENABLE ROW LEVEL SECURITY;
CREATE TABLE "public"."food_offers" (
  "id"           text    NOT NULL,
  "user_id"      uuid    NOT NULL,
  "product_name" text    NOT NULL,
  "price"        numeric NOT NULL,
  "store"        text    NOT NULL,
  "week_key"     text    NOT NULL,
  "source"       text    NOT NULL DEFAULT 'manual'::text,
  CONSTRAINT "food_offers_pkey" PRIMARY KEY (user_id, id)
);
ALTER TABLE "public"."food_offers"
  ENABLE ROW LEVEL SECURITY;
CREATE TABLE "public"."food_pantry_items" (
  "id"          text                     NOT NULL,
  "user_id"     uuid                     NOT NULL,
  "name"        text                     NOT NULL,
  "quantity"    text,
  "expiry_date" date,
  "added_at"    timestamp with time zone NOT NULL,
  CONSTRAINT "food_pantry_items_pkey" PRIMARY KEY (user_id, id)
);
ALTER TABLE "public"."food_pantry_items"
  ENABLE ROW LEVEL SECURITY;
CREATE TABLE "public"."food_purchases" (
  "id"      text                     NOT NULL,
  "user_id" uuid                     NOT NULL,
  "amount"  numeric                  NOT NULL,
  "date"    timestamp with time zone NOT NULL,
  CONSTRAINT "food_purchases_pkey" PRIMARY KEY (user_id, id)
);
ALTER TABLE "public"."food_purchases"
  ENABLE ROW LEVEL SECURITY;
CREATE TABLE "public"."food_recipes" (
  "id"           text    NOT NULL,
  "user_id"      uuid    NOT NULL,
  "name"         text    NOT NULL,
  "meal_type"    text    NOT NULL,
  "ingredients"  jsonb   NOT NULL DEFAULT '[]'::jsonb,
  "minutes"      integer,
  "instructions" text,
  "calories"     numeric,
  "protein"      numeric,
  "carbs"        numeric,
  "fat"          numeric,
  "tags"         jsonb   NOT NULL DEFAULT '[]'::jsonb,
  CONSTRAINT "food_recipes_pkey" PRIMARY KEY (user_id, id)
);
ALTER TABLE "public"."food_recipes"
  ENABLE ROW LEVEL SECURITY;
CREATE TABLE "public"."food_saved_plans" (
  "user_id"  uuid  NOT NULL,
  "week_key" text  NOT NULL,
  "slots"    jsonb NOT NULL DEFAULT '[]'::jsonb,
  CONSTRAINT "food_saved_plans_pkey" PRIMARY KEY (user_id, week_key)
);
ALTER TABLE "public"."food_saved_plans"
  ENABLE ROW LEVEL SECURITY;
CREATE TABLE "public"."food_selected_stores" (
  "user_id" uuid NOT NULL,
  "store"   text NOT NULL,
  CONSTRAINT "food_selected_stores_pkey" PRIMARY KEY (user_id, store)
);
ALTER TABLE "public"."food_selected_stores"
  ENABLE ROW LEVEL SECURITY;
CREATE TABLE "public"."food_shopping_items" (
  "id"      text    NOT NULL,
  "user_id" uuid    NOT NULL,
  "label"   text    NOT NULL,
  "checked" boolean NOT NULL DEFAULT false,
  CONSTRAINT "food_shopping_items_pkey" PRIMARY KEY (user_id, id)
);
ALTER TABLE "public"."food_shopping_items"
  ENABLE ROW LEVEL SECURITY;
CREATE TABLE "public"."food_standard_prices" (
  "id"           text    NOT NULL,
  "user_id"      uuid    NOT NULL,
  "product_name" text    NOT NULL,
  "store"        text    NOT NULL,
  "price"        numeric NOT NULL,
  CONSTRAINT "food_standard_prices_pkey" PRIMARY KEY (user_id, id)
);
ALTER TABLE "public"."food_standard_prices"
  ENABLE ROW LEVEL SECURITY;
CREATE TABLE "public"."global_offers" (
  "id"                uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "standard_price_id" uuid                     NOT NULL,
  "offer_price"       numeric                  NOT NULL,
  "valid_from"        date                     NOT NULL,
  "valid_to"          date                     NOT NULL,
  "created_at"        timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "global_offers_pkey" PRIMARY KEY (id)
);
ALTER TABLE "public"."global_offers"
  ENABLE ROW LEVEL SECURITY;
CREATE TABLE "public"."global_recipes" (
  "id"           uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "name"         text                     NOT NULL,
  "meal_type"    text                     NOT NULL,
  "ingredients"  jsonb                    NOT NULL DEFAULT '[]'::jsonb,
  "minutes"      integer,
  "instructions" text,
  "calories"     numeric,
  "protein"      numeric,
  "carbs"        numeric,
  "fat"          numeric,
  "tags"         text[]                   NOT NULL DEFAULT '{}'::text[],
  "created_at"   timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"   timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "global_recipes_meal_type_check" CHECK ((meal_type = ANY (ARRAY['breakfast'::text, 'lunch'::text, 'dinner'::text]))),
  CONSTRAINT "global_recipes_pkey" PRIMARY KEY (id)
);
ALTER TABLE "public"."global_recipes"
  ENABLE ROW LEVEL SECURITY;
CREATE TABLE "public"."global_standard_prices" (
  "id"           uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "product_name" text                     NOT NULL,
  "store"        text                     NOT NULL,
  "price"        numeric                  NOT NULL,
  "updated_at"   timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "global_standard_prices_pkey" PRIMARY KEY (id)
);
ALTER TABLE "public"."global_standard_prices"
  ENABLE ROW LEVEL SECURITY;
CREATE TABLE "public"."habits" (
  "id"              text                     NOT NULL,
  "user_id"         uuid                     NOT NULL,
  "title"           text                     NOT NULL,
  "direction"       text                     NOT NULL,
  "target_per_week" integer,
  "logs"            jsonb                    NOT NULL DEFAULT '[]'::jsonb,
  "created_at"      timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "habits_pkey" PRIMARY KEY (user_id, id)
);
ALTER TABLE "public"."habits"
  ENABLE ROW LEVEL SECURITY;
CREATE TABLE "public"."household_moving_items" (
  "id"      text    NOT NULL,
  "user_id" uuid    NOT NULL,
  "label"   text    NOT NULL,
  "checked" boolean NOT NULL DEFAULT false,
  CONSTRAINT "household_moving_items_pkey" PRIMARY KEY (user_id, id)
);
ALTER TABLE "public"."household_moving_items"
  ENABLE ROW LEVEL SECURITY;
CREATE TABLE "public"."household_shopping_items" (
  "id"      text    NOT NULL,
  "user_id" uuid    NOT NULL,
  "label"   text    NOT NULL,
  "checked" boolean NOT NULL DEFAULT false,
  CONSTRAINT "household_shopping_items_pkey" PRIMARY KEY (user_id, id)
);
ALTER TABLE "public"."household_shopping_items"
  ENABLE ROW LEVEL SECURITY;
CREATE TABLE "public"."household_tasks" (
  "id"         text                     NOT NULL,
  "user_id"    uuid                     NOT NULL,
  "kind"       text                     NOT NULL,
  "title"      text                     NOT NULL,
  "frequency"  text                     NOT NULL,
  "last_done"  date,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "household_tasks_pkey" PRIMARY KEY (user_id, id)
);
ALTER TABLE "public"."household_tasks"
  ENABLE ROW LEVEL SECURITY;
CREATE TABLE "public"."income" (
  "user_id"    uuid                     NOT NULL,
  "month_key"  text                     NOT NULL,
  "amount"     numeric                  NOT NULL,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "income_pkey" PRIMARY KEY (user_id, month_key)
);
ALTER TABLE "public"."income"
  ENABLE ROW LEVEL SECURITY;
CREATE TABLE "public"."job_applications" (
  "id"           text                     NOT NULL,
  "user_id"      uuid                     NOT NULL,
  "company"      text                     NOT NULL,
  "position"     text                     NOT NULL,
  "status"       text                     NOT NULL,
  "applied_date" date                     NOT NULL,
  "link"         text,
  "notes"        text,
  "created_at"   timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "job_applications_pkey" PRIMARY KEY (user_id, id)
);
ALTER TABLE "public"."job_applications"
  ENABLE ROW LEVEL SECURITY;
CREATE TABLE "public"."life_goals" (
  "id"          text                     NOT NULL,
  "user_id"     uuid                     NOT NULL,
  "title"       text                     NOT NULL,
  "description" text,
  "deadline"    date,
  "sub_goals"   jsonb                    NOT NULL DEFAULT '[]'::jsonb,
  "created_at"  timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "life_goals_pkey" PRIMARY KEY (user_id, id)
);
ALTER TABLE "public"."life_goals"
  ENABLE ROW LEVEL SECURITY;
CREATE TABLE "public"."profiles" (
  "id"         uuid                     NOT NULL,
  "name"       text,
  "age"        integer,
  "gender"     text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  "pin_hash"   text,
  CONSTRAINT "profiles_gender_check" CHECK ((gender = ANY (ARRAY['female'::text, 'male'::text, 'other'::text, 'unspecified'::text]))),
  CONSTRAINT "profiles_pkey" PRIMARY KEY (id)
);
ALTER TABLE "public"."profiles"
  ENABLE ROW LEVEL SECURITY;
CREATE TABLE "public"."savings_extra" (
  "user_id"    uuid                     NOT NULL,
  "amount"     numeric                  NOT NULL DEFAULT 0,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "savings_extra_pkey" PRIMARY KEY (user_id)
);
ALTER TABLE "public"."savings_extra"
  ENABLE ROW LEVEL SECURITY;
CREATE TABLE "public"."savings_goals" (
  "id"            text                     NOT NULL,
  "user_id"       uuid                     NOT NULL,
  "name"          text                     NOT NULL,
  "icon"          text                     NOT NULL,
  "target_amount" numeric                  NOT NULL,
  "saved_amount"  numeric                  NOT NULL DEFAULT 0,
  "created_at"    timestamp with time zone NOT NULL DEFAULT now(),
  "deadline"      date,
  "archived"      boolean                  NOT NULL DEFAULT false,
  CONSTRAINT "savings_goals_pkey" PRIMARY KEY (user_id, id)
);
ALTER TABLE "public"."savings_goals"
  ENABLE ROW LEVEL SECURITY;
CREATE TABLE "public"."savings_history" (
  "id"      text                     NOT NULL,
  "user_id" uuid                     NOT NULL,
  "goal_id" text                     NOT NULL,
  "amount"  numeric                  NOT NULL,
  "date"    timestamp with time zone NOT NULL,
  CONSTRAINT "savings_history_pkey" PRIMARY KEY (user_id, id)
);
ALTER TABLE "public"."savings_history"
  ENABLE ROW LEVEL SECURITY;
CREATE TABLE "public"."settings" (
  "id"         uuid                     NOT NULL,
  "language"   text,
  "theme_mode" text,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "settings_pkey" PRIMARY KEY (id),
  CONSTRAINT "settings_theme_mode_check" CHECK ((theme_mode = ANY (ARRAY['light'::text, 'dark'::text, 'system'::text])))
);
ALTER TABLE "public"."settings"
  ENABLE ROW LEVEL SECURITY;
CREATE TABLE "public"."skills" (
  "id"         text                     NOT NULL,
  "user_id"    uuid                     NOT NULL,
  "name"       text                     NOT NULL,
  "category"   text                     NOT NULL,
  "level"      text                     NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "skills_pkey" PRIMARY KEY (user_id, id)
);
ALTER TABLE "public"."skills"
  ENABLE ROW LEVEL SECURITY;
CREATE TABLE "public"."symptom_logs" (
  "id"       text  NOT NULL,
  "user_id"  uuid  NOT NULL,
  "date"     date  NOT NULL,
  "symptoms" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "flow"     text,
  "notes"    text,
  CONSTRAINT "symptom_logs_pkey" PRIMARY KEY (user_id, id)
);
ALTER TABLE "public"."symptom_logs"
  ENABLE ROW LEVEL SECURITY;
CREATE TABLE "public"."todos" (
  "id"          text                     NOT NULL,
  "user_id"     uuid                     NOT NULL,
  "title"       text                     NOT NULL,
  "description" text,
  "importance"  text                     NOT NULL,
  "due_date"    date,
  "completed"   boolean                  NOT NULL DEFAULT false,
  "created_at"  timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "todos_pkey" PRIMARY KEY (user_id, id)
);
ALTER TABLE "public"."todos"
  ENABLE ROW LEVEL SECURITY;
CREATE TABLE "public"."trip_expenses" (
  "id"              text    NOT NULL,
  "user_id"         uuid    NOT NULL,
  "trip_id"         text    NOT NULL,
  "name"            text    NOT NULL,
  "amount"          numeric NOT NULL,
  "category"        text    NOT NULL,
  "currency"        text,
  "original_amount" numeric,
  "exchange_rate"   numeric,
  CONSTRAINT "trip_expenses_pkey" PRIMARY KEY (user_id, id)
);
ALTER TABLE "public"."trip_expenses"
  ENABLE ROW LEVEL SECURITY;
CREATE TABLE "public"."trip_packing_items" (
  "id"       text    NOT NULL,
  "user_id"  uuid    NOT NULL,
  "trip_id"  text    NOT NULL,
  "label"    text    NOT NULL,
  "checked"  boolean NOT NULL DEFAULT false,
  "category" text    NOT NULL DEFAULT 'other'::text,
  CONSTRAINT "trip_packing_items_pkey" PRIMARY KEY (user_id, id)
);
ALTER TABLE "public"."trip_packing_items"
  ENABLE ROW LEVEL SECURITY;
CREATE TABLE "public"."trip_participants" (
  "trip_id"       text                     NOT NULL,
  "owner_id"      uuid                     NOT NULL,
  "user_id"       uuid                     NOT NULL,
  "invited_email" text                     NOT NULL,
  "status"        text                     NOT NULL DEFAULT 'pending'::text,
  "invited_at"    timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "trip_participants_pkey" PRIMARY KEY (trip_id, user_id),
  CONSTRAINT "trip_participants_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'accepted'::text, 'declined'::text])))
);
ALTER TABLE "public"."trip_participants"
  ENABLE ROW LEVEL SECURITY;
CREATE TABLE "public"."trips" (
  "id"         text                     NOT NULL,
  "user_id"    uuid                     NOT NULL,
  "name"       text                     NOT NULL,
  "start_date" date                     NOT NULL,
  "end_date"   date                     NOT NULL,
  "budget"     numeric,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "trips_pkey" PRIMARY KEY (user_id, id)
);
ALTER TABLE "public"."trips"
  ENABLE ROW LEVEL SECURITY;
CREATE TABLE "public"."warranties" (
  "id"          text                     NOT NULL,
  "user_id"     uuid                     NOT NULL,
  "name"        text                     NOT NULL,
  "type"        text                     NOT NULL,
  "expiry_date" date                     NOT NULL,
  "notes"       text,
  "created_at"  timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "warranties_pkey" PRIMARY KEY (user_id, id)
);
ALTER TABLE "public"."warranties"
  ENABLE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION public.handle_new_user()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  AS $function$
begin
  insert into public.profiles (id, name, age, gender)
  values (
    new.id,
    new.raw_user_meta_data->>'name',
    (new.raw_user_meta_data->>'age')::integer,
    coalesce(new.raw_user_meta_data->>'gender', 'unspecified')
  );
  return new;
end;
$function$;
CREATE OR REPLACE FUNCTION public.handle_updated_at()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;
CREATE OR REPLACE FUNCTION public.invite_trip_participant (
  p_trip_id text,
  p_email   text
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  AS $function$
declare
  v_user_id uuid;
  v_owner_id uuid := auth.uid();
begin
  select id into v_user_id from auth.users where email = p_email limit 1;

  if v_user_id is null then
    raise exception 'no_account_found';
  end if;

  if v_user_id = v_owner_id then
    raise exception 'cannot_invite_self';
  end if;

  insert into public.trip_participants (trip_id, owner_id, user_id, invited_email, status)
  values (p_trip_id, v_owner_id, v_user_id, p_email, 'pending')
  on conflict (trip_id, user_id) do nothing;
end;
$function$;
ALTER TABLE "public"."admin_users"
  ADD CONSTRAINT "admin_users_id_fkey" FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE "public"."categories"
  ADD CONSTRAINT "categories_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE "public"."cv_education"
  ADD CONSTRAINT "cv_education_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE "public"."cv_experience"
  ADD CONSTRAINT "cv_experience_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE "public"."cv_languages"
  ADD CONSTRAINT "cv_languages_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE "public"."cv_personal_info"
  ADD CONSTRAINT "cv_personal_info_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE "public"."cv_versions"
  ADD CONSTRAINT "cv_versions_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE "public"."cycle_settings"
  ADD CONSTRAINT "cycle_settings_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE "public"."cycles"
  ADD CONSTRAINT "cycles_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE "public"."expense_category_budgets"
  ADD CONSTRAINT "expense_category_budgets_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE "public"."expenses"
  ADD CONSTRAINT "expenses_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE "public"."food_monthly_budget"
  ADD CONSTRAINT "food_monthly_budget_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE "public"."food_offers"
  ADD CONSTRAINT "food_offers_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE "public"."food_pantry_items"
  ADD CONSTRAINT "food_pantry_items_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE "public"."food_purchases"
  ADD CONSTRAINT "food_purchases_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE "public"."food_recipes"
  ADD CONSTRAINT "food_recipes_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE "public"."food_saved_plans"
  ADD CONSTRAINT "food_saved_plans_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE "public"."food_selected_stores"
  ADD CONSTRAINT "food_selected_stores_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE "public"."food_shopping_items"
  ADD CONSTRAINT "food_shopping_items_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE "public"."food_standard_prices"
  ADD CONSTRAINT "food_standard_prices_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE "public"."global_offers"
  ADD CONSTRAINT "global_offers_standard_price_id_fkey" FOREIGN KEY (standard_price_id) REFERENCES public.global_standard_prices(id) ON DELETE CASCADE;
ALTER TABLE "public"."habits"
  ADD CONSTRAINT "habits_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE "public"."household_moving_items"
  ADD CONSTRAINT "household_moving_items_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE "public"."household_shopping_items"
  ADD CONSTRAINT "household_shopping_items_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE "public"."household_tasks"
  ADD CONSTRAINT "household_tasks_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE "public"."income"
  ADD CONSTRAINT "income_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE "public"."job_applications"
  ADD CONSTRAINT "job_applications_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE "public"."life_goals"
  ADD CONSTRAINT "life_goals_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE "public"."profiles"
  ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE "public"."savings_extra"
  ADD CONSTRAINT "savings_extra_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE "public"."savings_goals"
  ADD CONSTRAINT "savings_goals_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE "public"."savings_history"
  ADD CONSTRAINT "savings_history_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE "public"."settings"
  ADD CONSTRAINT "settings_id_fkey" FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE "public"."skills"
  ADD CONSTRAINT "skills_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE "public"."symptom_logs"
  ADD CONSTRAINT "symptom_logs_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE "public"."todos"
  ADD CONSTRAINT "todos_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE "public"."trip_expenses"
  ADD CONSTRAINT "trip_expenses_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE "public"."trip_packing_items"
  ADD CONSTRAINT "trip_packing_items_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE "public"."trip_participants"
  ADD CONSTRAINT "trip_participants_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE "public"."trips"
  ADD CONSTRAINT "trips_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE "public"."warranties"
  ADD CONSTRAINT "warranties_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
CREATE INDEX idx_global_offers_valid ON public.global_offers USING btree (valid_from, valid_to);
CREATE INDEX idx_global_prices_product ON public.global_standard_prices USING btree (product_name);
CREATE INDEX idx_global_prices_store ON public.global_standard_prices USING btree (store);
CREATE INDEX idx_global_recipes_meal_type ON public.global_recipes USING btree (meal_type);
CREATE INDEX idx_global_recipes_name ON public.global_recipes USING btree (name);
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.income
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.savings_extra
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.settings
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();
CREATE POLICY "Users can check their own admin status" ON "public"."admin_users"
  FOR SELECT
  TO PUBLIC
  USING ((auth.uid() = id));
CREATE POLICY "Users can delete their own categories" ON "public"."categories"
  FOR DELETE
  TO PUBLIC
  USING ((auth.uid() = user_id));
CREATE POLICY "Users can insert their own categories" ON "public"."categories"
  FOR INSERT
  TO PUBLIC
  WITH CHECK ((auth.uid() = user_id));
CREATE POLICY "Users can view their own categories" ON "public"."categories"
  FOR SELECT
  TO PUBLIC
  USING ((auth.uid() = user_id));
CREATE POLICY "Users can delete their own cv education" ON "public"."cv_education"
  FOR DELETE
  TO PUBLIC
  USING ((auth.uid() = user_id));
CREATE POLICY "Users can insert their own cv education" ON "public"."cv_education"
  FOR INSERT
  TO PUBLIC
  WITH CHECK ((auth.uid() = user_id));
CREATE POLICY "Users can update their own cv education" ON "public"."cv_education"
  FOR UPDATE
  TO PUBLIC
  USING ((auth.uid() = user_id));
CREATE POLICY "Users can view their own cv education" ON "public"."cv_education"
  FOR SELECT
  TO PUBLIC
  USING ((auth.uid() = user_id));
CREATE POLICY "Users can delete their own cv experience" ON "public"."cv_experience"
  FOR DELETE
  TO PUBLIC
  USING ((auth.uid() = user_id));
CREATE POLICY "Users can insert their own cv experience" ON "public"."cv_experience"
  FOR INSERT
  TO PUBLIC
  WITH CHECK ((auth.uid() = user_id));
CREATE POLICY "Users can update their own cv experience" ON "public"."cv_experience"
  FOR UPDATE
  TO PUBLIC
  USING ((auth.uid() = user_id));
CREATE POLICY "Users can view their own cv experience" ON "public"."cv_experience"
  FOR SELECT
  TO PUBLIC
  USING ((auth.uid() = user_id));
CREATE POLICY "Users can delete their own cv languages" ON "public"."cv_languages"
  FOR DELETE
  TO PUBLIC
  USING ((auth.uid() = user_id));
CREATE POLICY "Users can insert their own cv languages" ON "public"."cv_languages"
  FOR INSERT
  TO PUBLIC
  WITH CHECK ((auth.uid() = user_id));
CREATE POLICY "Users can update their own cv languages" ON "public"."cv_languages"
  FOR UPDATE
  TO PUBLIC
  USING ((auth.uid() = user_id));
CREATE POLICY "Users can view their own cv languages" ON "public"."cv_languages"
  FOR SELECT
  TO PUBLIC
  USING ((auth.uid() = user_id));
CREATE POLICY "Users can insert their own cv personal info" ON "public"."cv_personal_info"
  FOR INSERT
  TO PUBLIC
  WITH CHECK ((auth.uid() = user_id));
CREATE POLICY "Users can update their own cv personal info" ON "public"."cv_personal_info"
  FOR UPDATE
  TO PUBLIC
  USING ((auth.uid() = user_id));
CREATE POLICY "Users can view their own cv personal info" ON "public"."cv_personal_info"
  FOR SELECT
  TO PUBLIC
  USING ((auth.uid() = user_id));
CREATE POLICY "Users can delete their own cv versions" ON "public"."cv_versions"
  FOR DELETE
  TO PUBLIC
  USING ((auth.uid() = user_id));
CREATE POLICY "Users can insert their own cv versions" ON "public"."cv_versions"
  FOR INSERT
  TO PUBLIC
  WITH CHECK ((auth.uid() = user_id));
CREATE POLICY "Users can view their own cv versions" ON "public"."cv_versions"
  FOR SELECT
  TO PUBLIC
  USING ((auth.uid() = user_id));
CREATE POLICY "Users can insert their own cycle settings" ON "public"."cycle_settings"
  FOR INSERT
  TO PUBLIC
  WITH CHECK ((auth.uid() = user_id));
CREATE POLICY "Users can update their own cycle settings" ON "public"."cycle_settings"
  FOR UPDATE
  TO PUBLIC
  USING ((auth.uid() = user_id));
CREATE POLICY "Users can view their own cycle settings" ON "public"."cycle_settings"
  FOR SELECT
  TO PUBLIC
  USING ((auth.uid() = user_id));
CREATE POLICY "Users can delete their own cycles" ON "public"."cycles"
  FOR DELETE
  TO PUBLIC
  USING ((auth.uid() = user_id));
CREATE POLICY "Users can insert their own cycles" ON "public"."cycles"
  FOR INSERT
  TO PUBLIC
  WITH CHECK ((auth.uid() = user_id));
CREATE POLICY "Users can update their own cycles" ON "public"."cycles"
  FOR UPDATE
  TO PUBLIC
  USING ((auth.uid() = user_id));
CREATE POLICY "Users can view their own cycles" ON "public"."cycles"
  FOR SELECT
  TO PUBLIC
  USING ((auth.uid() = user_id));
CREATE POLICY "Users can delete their own category budgets" ON "public"."expense_category_budgets"
  FOR DELETE
  TO PUBLIC
  USING ((auth.uid() = user_id));
CREATE POLICY "Users can insert their own category budgets" ON "public"."expense_category_budgets"
  FOR INSERT
  TO PUBLIC
  WITH CHECK ((auth.uid() = user_id));
CREATE POLICY "Users can update their own category budgets" ON "public"."expense_category_budgets"
  FOR UPDATE
  TO PUBLIC
  USING ((auth.uid() = user_id));
CREATE POLICY "Users can view their own category budgets" ON "public"."expense_category_budgets"
  FOR SELECT
  TO PUBLIC
  USING ((auth.uid() = user_id));
CREATE POLICY "Users can delete their own expenses" ON "public"."expenses"
  FOR DELETE
  TO PUBLIC
  USING ((auth.uid() = user_id));
CREATE POLICY "Users can insert their own expenses" ON "public"."expenses"
  FOR INSERT
  TO PUBLIC
  WITH CHECK ((auth.uid() = user_id));
CREATE POLICY "Users can update their own expenses" ON "public"."expenses"
  FOR UPDATE
  TO PUBLIC
  USING ((auth.uid() = user_id));
CREATE POLICY "Users can view their own expenses" ON "public"."expenses"
  FOR SELECT
  TO PUBLIC
  USING ((auth.uid() = user_id));
CREATE POLICY "insert own" ON "public"."food_monthly_budget"
  FOR INSERT
  TO PUBLIC
  WITH CHECK ((auth.uid() = user_id));
CREATE POLICY "select own" ON "public"."food_monthly_budget"
  FOR SELECT
  TO PUBLIC
  USING ((auth.uid() = user_id));
CREATE POLICY "update own" ON "public"."food_monthly_budget"
  FOR UPDATE
  TO PUBLIC
  USING ((auth.uid() = user_id));
CREATE POLICY "delete own" ON "public"."food_offers"
  FOR DELETE
  TO PUBLIC
  USING ((auth.uid() = user_id));
CREATE POLICY "insert own" ON "public"."food_offers"
  FOR INSERT
  TO PUBLIC
  WITH CHECK ((auth.uid() = user_id));
CREATE POLICY "select own" ON "public"."food_offers"
  FOR SELECT
  TO PUBLIC
  USING ((auth.uid() = user_id));
CREATE POLICY "delete own" ON "public"."food_pantry_items"
  FOR DELETE
  TO PUBLIC
  USING ((auth.uid() = user_id));
CREATE POLICY "insert own" ON "public"."food_pantry_items"
  FOR INSERT
  TO PUBLIC
  WITH CHECK ((auth.uid() = user_id));
CREATE POLICY "select own" ON "public"."food_pantry_items"
  FOR SELECT
  TO PUBLIC
  USING ((auth.uid() = user_id));
CREATE POLICY "delete own" ON "public"."food_purchases"
  FOR DELETE
  TO PUBLIC
  USING ((auth.uid() = user_id));
CREATE POLICY "insert own" ON "public"."food_purchases"
  FOR INSERT
  TO PUBLIC
  WITH CHECK ((auth.uid() = user_id));
CREATE POLICY "select own" ON "public"."food_purchases"
  FOR SELECT
  TO PUBLIC
  USING ((auth.uid() = user_id));
CREATE POLICY "delete own" ON "public"."food_recipes"
  FOR DELETE
  TO PUBLIC
  USING ((auth.uid() = user_id));
CREATE POLICY "insert own" ON "public"."food_recipes"
  FOR INSERT
  TO PUBLIC
  WITH CHECK ((auth.uid() = user_id));
CREATE POLICY "select own" ON "public"."food_recipes"
  FOR SELECT
  TO PUBLIC
  USING ((auth.uid() = user_id));
CREATE POLICY "update own" ON "public"."food_recipes"
  FOR UPDATE
  TO PUBLIC
  USING ((auth.uid() = user_id));
CREATE POLICY "insert own" ON "public"."food_saved_plans"
  FOR INSERT
  TO PUBLIC
  WITH CHECK ((auth.uid() = user_id));
CREATE POLICY "select own" ON "public"."food_saved_plans"
  FOR SELECT
  TO PUBLIC
  USING ((auth.uid() = user_id));
CREATE POLICY "update own" ON "public"."food_saved_plans"
  FOR UPDATE
  TO PUBLIC
  USING ((auth.uid() = user_id));
CREATE POLICY "delete own" ON "public"."food_selected_stores"
  FOR DELETE
  TO PUBLIC
  USING ((auth.uid() = user_id));
CREATE POLICY "insert own" ON "public"."food_selected_stores"
  FOR INSERT
  TO PUBLIC
  WITH CHECK ((auth.uid() = user_id));
CREATE POLICY "select own" ON "public"."food_selected_stores"
  FOR SELECT
  TO PUBLIC
  USING ((auth.uid() = user_id));
CREATE POLICY "delete own" ON "public"."food_shopping_items"
  FOR DELETE
  TO PUBLIC
  USING ((auth.uid() = user_id));
CREATE POLICY "insert own" ON "public"."food_shopping_items"
  FOR INSERT
  TO PUBLIC
  WITH CHECK ((auth.uid() = user_id));
CREATE POLICY "select own" ON "public"."food_shopping_items"
  FOR SELECT
  TO PUBLIC
  USING ((auth.uid() = user_id));
CREATE POLICY "update own" ON "public"."food_shopping_items"
  FOR UPDATE
  TO PUBLIC
  USING ((auth.uid() = user_id));
CREATE POLICY "delete own" ON "public"."food_standard_prices"
  FOR DELETE
  TO PUBLIC
  USING ((auth.uid() = user_id));
CREATE POLICY "insert own" ON "public"."food_standard_prices"
  FOR INSERT
  TO PUBLIC
  WITH CHECK ((auth.uid() = user_id));
CREATE POLICY "select own" ON "public"."food_standard_prices"
  FOR SELECT
  TO PUBLIC
  USING ((auth.uid() = user_id));
CREATE POLICY "Admins can delete global offers" ON "public"."global_offers"
  FOR DELETE
  TO PUBLIC
  USING ((auth.uid() IN ( SELECT admin_users.id
   FROM public.admin_users)));
CREATE POLICY "Admins can insert global offers" ON "public"."global_offers"
  FOR INSERT
  TO PUBLIC
  WITH CHECK ((auth.uid() IN ( SELECT admin_users.id
   FROM public.admin_users)));
CREATE POLICY "Admins can update global offers" ON "public"."global_offers"
  FOR UPDATE
  TO PUBLIC
  USING ((auth.uid() IN ( SELECT admin_users.id
   FROM public.admin_users)));
CREATE POLICY "Anyone can view global offers" ON "public"."global_offers"
  FOR SELECT
  TO PUBLIC
  USING (true);
CREATE POLICY "Admins can delete global recipes" ON "public"."global_recipes"
  FOR DELETE
  TO PUBLIC
  USING ((auth.uid() IN ( SELECT admin_users.id
   FROM public.admin_users)));
CREATE POLICY "Admins can insert global recipes" ON "public"."global_recipes"
  FOR INSERT
  TO PUBLIC
  WITH CHECK ((auth.uid() IN ( SELECT admin_users.id
   FROM public.admin_users)));
CREATE POLICY "Admins can update global recipes" ON "public"."global_recipes"
  FOR UPDATE
  TO PUBLIC
  USING ((auth.uid() IN ( SELECT admin_users.id
   FROM public.admin_users)));
CREATE POLICY "Anyone can view global recipes" ON "public"."global_recipes"
  FOR SELECT
  TO PUBLIC
  USING (true);
CREATE POLICY "Admins can delete global prices" ON "public"."global_standard_prices"
  FOR DELETE
  TO PUBLIC
  USING ((auth.uid() IN ( SELECT admin_users.id
   FROM public.admin_users)));
CREATE POLICY "Admins can insert global prices" ON "public"."global_standard_prices"
  FOR INSERT
  TO PUBLIC
  WITH CHECK ((auth.uid() IN ( SELECT admin_users.id
   FROM public.admin_users)));
CREATE POLICY "Admins can update global prices" ON "public"."global_standard_prices"
  FOR UPDATE
  TO PUBLIC
  USING ((auth.uid() IN ( SELECT admin_users.id
   FROM public.admin_users)));
CREATE POLICY "Anyone can view global prices" ON "public"."global_standard_prices"
  FOR SELECT
  TO PUBLIC
  USING (true);
CREATE POLICY "Users can delete their own habits" ON "public"."habits"
  FOR DELETE
  TO PUBLIC
  USING ((auth.uid() = user_id));
CREATE POLICY "Users can insert their own habits" ON "public"."habits"
  FOR INSERT
  TO PUBLIC
  WITH CHECK ((auth.uid() = user_id));
CREATE POLICY "Users can update their own habits" ON "public"."habits"
  FOR UPDATE
  TO PUBLIC
  USING ((auth.uid() = user_id));
CREATE POLICY "Users can view their own habits" ON "public"."habits"
  FOR SELECT
  TO PUBLIC
  USING ((auth.uid() = user_id));
CREATE POLICY "Users can delete their own moving items" ON "public"."household_moving_items"
  FOR DELETE
  TO PUBLIC
  USING ((auth.uid() = user_id));
CREATE POLICY "Users can insert their own moving items" ON "public"."household_moving_items"
  FOR INSERT
  TO PUBLIC
  WITH CHECK ((auth.uid() = user_id));
CREATE POLICY "Users can update their own moving items" ON "public"."household_moving_items"
  FOR UPDATE
  TO PUBLIC
  USING ((auth.uid() = user_id));
CREATE POLICY "Users can view their own moving items" ON "public"."household_moving_items"
  FOR SELECT
  TO PUBLIC
  USING ((auth.uid() = user_id));
CREATE POLICY "Users can delete their own shopping items" ON "public"."household_shopping_items"
  FOR DELETE
  TO PUBLIC
  USING ((auth.uid() = user_id));
CREATE POLICY "Users can insert their own shopping items" ON "public"."household_shopping_items"
  FOR INSERT
  TO PUBLIC
  WITH CHECK ((auth.uid() = user_id));
CREATE POLICY "Users can update their own shopping items" ON "public"."household_shopping_items"
  FOR UPDATE
  TO PUBLIC
  USING ((auth.uid() = user_id));
CREATE POLICY "Users can view their own shopping items" ON "public"."household_shopping_items"
  FOR SELECT
  TO PUBLIC
  USING ((auth.uid() = user_id));
CREATE POLICY "Users can delete their own household tasks" ON "public"."household_tasks"
  FOR DELETE
  TO PUBLIC
  USING ((auth.uid() = user_id));
CREATE POLICY "Users can insert their own household tasks" ON "public"."household_tasks"
  FOR INSERT
  TO PUBLIC
  WITH CHECK ((auth.uid() = user_id));
CREATE POLICY "Users can update their own household tasks" ON "public"."household_tasks"
  FOR UPDATE
  TO PUBLIC
  USING ((auth.uid() = user_id));
CREATE POLICY "Users can view their own household tasks" ON "public"."household_tasks"
  FOR SELECT
  TO PUBLIC
  USING ((auth.uid() = user_id));
CREATE POLICY "Users can update their own income" ON "public"."income"
  FOR UPDATE
  TO PUBLIC
  USING ((auth.uid() = user_id));
CREATE POLICY "Users can upsert their own income" ON "public"."income"
  FOR INSERT
  TO PUBLIC
  WITH CHECK ((auth.uid() = user_id));
CREATE POLICY "Users can view their own income" ON "public"."income"
  FOR SELECT
  TO PUBLIC
  USING ((auth.uid() = user_id));
CREATE POLICY "Users can delete their own applications" ON "public"."job_applications"
  FOR DELETE
  TO PUBLIC
  USING ((auth.uid() = user_id));
CREATE POLICY "Users can insert their own applications" ON "public"."job_applications"
  FOR INSERT
  TO PUBLIC
  WITH CHECK ((auth.uid() = user_id));
CREATE POLICY "Users can update their own applications" ON "public"."job_applications"
  FOR UPDATE
  TO PUBLIC
  USING ((auth.uid() = user_id));
CREATE POLICY "Users can view their own applications" ON "public"."job_applications"
  FOR SELECT
  TO PUBLIC
  USING ((auth.uid() = user_id));
CREATE POLICY "Users can delete their own life goals" ON "public"."life_goals"
  FOR DELETE
  TO PUBLIC
  USING ((auth.uid() = user_id));
CREATE POLICY "Users can insert their own life goals" ON "public"."life_goals"
  FOR INSERT
  TO PUBLIC
  WITH CHECK ((auth.uid() = user_id));
CREATE POLICY "Users can update their own life goals" ON "public"."life_goals"
  FOR UPDATE
  TO PUBLIC
  USING ((auth.uid() = user_id));
CREATE POLICY "Users can view their own life goals" ON "public"."life_goals"
  FOR SELECT
  TO PUBLIC
  USING ((auth.uid() = user_id));
CREATE POLICY "Users can insert their own profile" ON "public"."profiles"
  FOR INSERT
  TO PUBLIC
  WITH CHECK ((auth.uid() = id));
CREATE POLICY "Users can update their own profile" ON "public"."profiles"
  FOR UPDATE
  TO PUBLIC
  USING ((auth.uid() = id));
CREATE POLICY "Users can view their own profile" ON "public"."profiles"
  FOR SELECT
  TO PUBLIC
  USING ((auth.uid() = id));
CREATE POLICY "Users can insert their own extra savings" ON "public"."savings_extra"
  FOR INSERT
  TO PUBLIC
  WITH CHECK ((auth.uid() = user_id));
CREATE POLICY "Users can update their own extra savings" ON "public"."savings_extra"
  FOR UPDATE
  TO PUBLIC
  USING ((auth.uid() = user_id));
CREATE POLICY "Users can view their own extra savings" ON "public"."savings_extra"
  FOR SELECT
  TO PUBLIC
  USING ((auth.uid() = user_id));
CREATE POLICY "Users can delete their own savings goals" ON "public"."savings_goals"
  FOR DELETE
  TO PUBLIC
  USING ((auth.uid() = user_id));
CREATE POLICY "Users can insert their own savings goals" ON "public"."savings_goals"
  FOR INSERT
  TO PUBLIC
  WITH CHECK ((auth.uid() = user_id));
CREATE POLICY "Users can update their own savings goals" ON "public"."savings_goals"
  FOR UPDATE
  TO PUBLIC
  USING ((auth.uid() = user_id));
CREATE POLICY "Users can view their own savings goals" ON "public"."savings_goals"
  FOR SELECT
  TO PUBLIC
  USING ((auth.uid() = user_id));
CREATE POLICY "Users can delete their own savings history" ON "public"."savings_history"
  FOR DELETE
  TO PUBLIC
  USING ((auth.uid() = user_id));
CREATE POLICY "Users can insert their own savings history" ON "public"."savings_history"
  FOR INSERT
  TO PUBLIC
  WITH CHECK ((auth.uid() = user_id));
CREATE POLICY "Users can view their own savings history" ON "public"."savings_history"
  FOR SELECT
  TO PUBLIC
  USING ((auth.uid() = user_id));
CREATE POLICY "Users can insert their own settings" ON "public"."settings"
  FOR INSERT
  TO PUBLIC
  WITH CHECK ((auth.uid() = id));
CREATE POLICY "Users can update their own settings" ON "public"."settings"
  FOR UPDATE
  TO PUBLIC
  USING ((auth.uid() = id));
CREATE POLICY "Users can view their own settings" ON "public"."settings"
  FOR SELECT
  TO PUBLIC
  USING ((auth.uid() = id));
CREATE POLICY "Users can delete their own skills" ON "public"."skills"
  FOR DELETE
  TO PUBLIC
  USING ((auth.uid() = user_id));
CREATE POLICY "Users can insert their own skills" ON "public"."skills"
  FOR INSERT
  TO PUBLIC
  WITH CHECK ((auth.uid() = user_id));
CREATE POLICY "Users can update their own skills" ON "public"."skills"
  FOR UPDATE
  TO PUBLIC
  USING ((auth.uid() = user_id));
CREATE POLICY "Users can view their own skills" ON "public"."skills"
  FOR SELECT
  TO PUBLIC
  USING ((auth.uid() = user_id));
CREATE POLICY "Users can delete their own symptom logs" ON "public"."symptom_logs"
  FOR DELETE
  TO PUBLIC
  USING ((auth.uid() = user_id));
CREATE POLICY "Users can insert their own symptom logs" ON "public"."symptom_logs"
  FOR INSERT
  TO PUBLIC
  WITH CHECK ((auth.uid() = user_id));
CREATE POLICY "Users can update their own symptom logs" ON "public"."symptom_logs"
  FOR UPDATE
  TO PUBLIC
  USING ((auth.uid() = user_id));
CREATE POLICY "Users can view their own symptom logs" ON "public"."symptom_logs"
  FOR SELECT
  TO PUBLIC
  USING ((auth.uid() = user_id));
CREATE POLICY "Users can delete their own todos" ON "public"."todos"
  FOR DELETE
  TO PUBLIC
  USING ((auth.uid() = user_id));
CREATE POLICY "Users can insert their own todos" ON "public"."todos"
  FOR INSERT
  TO PUBLIC
  WITH CHECK ((auth.uid() = user_id));
CREATE POLICY "Users can update their own todos" ON "public"."todos"
  FOR UPDATE
  TO PUBLIC
  USING ((auth.uid() = user_id));
CREATE POLICY "Users can view their own todos" ON "public"."todos"
  FOR SELECT
  TO PUBLIC
  USING ((auth.uid() = user_id));
CREATE POLICY "Participants can delete shared trip expenses" ON "public"."trip_expenses"
  FOR DELETE
  TO PUBLIC
  USING ((trip_id IN ( SELECT trip_participants.trip_id
   FROM public.trip_participants
  WHERE ((trip_participants.user_id = auth.uid()) AND (trip_participants.status = 'accepted'::text)))));
CREATE POLICY "Participants can insert shared trip expenses" ON "public"."trip_expenses"
  FOR INSERT
  TO PUBLIC
  WITH CHECK ((trip_id IN ( SELECT trip_participants.trip_id
   FROM public.trip_participants
  WHERE ((trip_participants.user_id = auth.uid()) AND (trip_participants.status = 'accepted'::text)))));
CREATE POLICY "Participants can update shared trip expenses" ON "public"."trip_expenses"
  FOR UPDATE
  TO PUBLIC
  USING ((trip_id IN ( SELECT trip_participants.trip_id
   FROM public.trip_participants
  WHERE ((trip_participants.user_id = auth.uid()) AND (trip_participants.status = 'accepted'::text)))));
CREATE POLICY "Participants can view shared trip expenses" ON "public"."trip_expenses"
  FOR SELECT
  TO PUBLIC
  USING ((trip_id IN ( SELECT trip_participants.trip_id
   FROM public.trip_participants
  WHERE ((trip_participants.user_id = auth.uid()) AND (trip_participants.status = 'accepted'::text)))));
CREATE POLICY "Users can delete their own trip expenses" ON "public"."trip_expenses"
  FOR DELETE
  TO PUBLIC
  USING ((auth.uid() = user_id));
CREATE POLICY "Users can insert their own trip expenses" ON "public"."trip_expenses"
  FOR INSERT
  TO PUBLIC
  WITH CHECK ((auth.uid() = user_id));
CREATE POLICY "Users can update their own trip expenses" ON "public"."trip_expenses"
  FOR UPDATE
  TO PUBLIC
  USING ((auth.uid() = user_id));
CREATE POLICY "Users can view their own trip expenses" ON "public"."trip_expenses"
  FOR SELECT
  TO PUBLIC
  USING ((auth.uid() = user_id));
CREATE POLICY "Participants can delete shared packing items" ON "public"."trip_packing_items"
  FOR DELETE
  TO PUBLIC
  USING ((trip_id IN ( SELECT trip_participants.trip_id
   FROM public.trip_participants
  WHERE ((trip_participants.user_id = auth.uid()) AND (trip_participants.status = 'accepted'::text)))));
CREATE POLICY "Participants can insert shared packing items" ON "public"."trip_packing_items"
  FOR INSERT
  TO PUBLIC
  WITH CHECK ((trip_id IN ( SELECT trip_participants.trip_id
   FROM public.trip_participants
  WHERE ((trip_participants.user_id = auth.uid()) AND (trip_participants.status = 'accepted'::text)))));
CREATE POLICY "Participants can update shared packing items" ON "public"."trip_packing_items"
  FOR UPDATE
  TO PUBLIC
  USING ((trip_id IN ( SELECT trip_participants.trip_id
   FROM public.trip_participants
  WHERE ((trip_participants.user_id = auth.uid()) AND (trip_participants.status = 'accepted'::text)))));
CREATE POLICY "Participants can view shared packing items" ON "public"."trip_packing_items"
  FOR SELECT
  TO PUBLIC
  USING ((trip_id IN ( SELECT trip_participants.trip_id
   FROM public.trip_participants
  WHERE ((trip_participants.user_id = auth.uid()) AND (trip_participants.status = 'accepted'::text)))));
CREATE POLICY "Users can delete their own packing items" ON "public"."trip_packing_items"
  FOR DELETE
  TO PUBLIC
  USING ((auth.uid() = user_id));
CREATE POLICY "Users can insert their own packing items" ON "public"."trip_packing_items"
  FOR INSERT
  TO PUBLIC
  WITH CHECK ((auth.uid() = user_id));
CREATE POLICY "Users can update their own packing items" ON "public"."trip_packing_items"
  FOR UPDATE
  TO PUBLIC
  USING ((auth.uid() = user_id));
CREATE POLICY "Users can view their own packing items" ON "public"."trip_packing_items"
  FOR SELECT
  TO PUBLIC
  USING ((auth.uid() = user_id));
CREATE POLICY "Invited users can respond to their own invitations" ON "public"."trip_participants"
  FOR UPDATE
  TO PUBLIC
  USING ((auth.uid() = user_id))
  WITH CHECK ((auth.uid() = user_id));
CREATE POLICY "Invited users can view their own invitations" ON "public"."trip_participants"
  FOR SELECT
  TO PUBLIC
  USING ((auth.uid() = user_id));
CREATE POLICY "Owners can invite participants to their trips" ON "public"."trip_participants"
  FOR INSERT
  TO PUBLIC
  WITH CHECK ((auth.uid() = owner_id));
CREATE POLICY "Owners can remove participants from their trips" ON "public"."trip_participants"
  FOR DELETE
  TO PUBLIC
  USING ((auth.uid() = owner_id));
CREATE POLICY "Owners can view participants of their trips" ON "public"."trip_participants"
  FOR SELECT
  TO PUBLIC
  USING ((auth.uid() = owner_id));
CREATE POLICY "Participants can update shared trips" ON "public"."trips"
  FOR UPDATE
  TO PUBLIC
  USING ((id IN ( SELECT trip_participants.trip_id
   FROM public.trip_participants
  WHERE ((trip_participants.user_id = auth.uid()) AND (trip_participants.status = 'accepted'::text)))));
CREATE POLICY "Participants can view shared trips" ON "public"."trips"
  FOR SELECT
  TO PUBLIC
  USING ((id IN ( SELECT trip_participants.trip_id
   FROM public.trip_participants
  WHERE ((trip_participants.user_id = auth.uid()) AND (trip_participants.status = 'accepted'::text)))));
CREATE POLICY "Users can delete their own trips" ON "public"."trips"
  FOR DELETE
  TO PUBLIC
  USING ((auth.uid() = user_id));
CREATE POLICY "Users can insert their own trips" ON "public"."trips"
  FOR INSERT
  TO PUBLIC
  WITH CHECK ((auth.uid() = user_id));
CREATE POLICY "Users can update their own trips" ON "public"."trips"
  FOR UPDATE
  TO PUBLIC
  USING ((auth.uid() = user_id));
CREATE POLICY "Users can view their own trips" ON "public"."trips"
  FOR SELECT
  TO PUBLIC
  USING ((auth.uid() = user_id));
CREATE POLICY "Users can delete their own warranties" ON "public"."warranties"
  FOR DELETE
  TO PUBLIC
  USING ((auth.uid() = user_id));
CREATE POLICY "Users can insert their own warranties" ON "public"."warranties"
  FOR INSERT
  TO PUBLIC
  WITH CHECK ((auth.uid() = user_id));
CREATE POLICY "Users can update their own warranties" ON "public"."warranties"
  FOR UPDATE
  TO PUBLIC
  USING ((auth.uid() = user_id));
CREATE POLICY "Users can view their own warranties" ON "public"."warranties"
  FOR SELECT
  TO PUBLIC
  USING ((auth.uid() = user_id));
GRANT EXECUTE ON FUNCTION "public"."handle_new_user"() TO PUBLIC, "anon", "authenticated", "postgres", "service_role";
GRANT EXECUTE ON FUNCTION "public"."handle_updated_at"() TO PUBLIC, "anon", "authenticated", "postgres", "service_role";
GRANT EXECUTE ON FUNCTION "public"."invite_trip_participant"(text, text) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."admin_users" TO "anon", "authenticated", "postgres", "service_role";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."categories" TO "anon", "authenticated", "postgres", "service_role";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."cv_education" TO "anon", "authenticated", "postgres", "service_role";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."cv_experience" TO "anon", "authenticated", "postgres", "service_role";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."cv_languages" TO "anon", "authenticated", "postgres", "service_role";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."cv_personal_info" TO "anon", "authenticated", "postgres", "service_role";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."cv_versions" TO "anon", "authenticated", "postgres", "service_role";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."cycle_settings" TO "anon", "authenticated", "postgres", "service_role";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."cycles" TO "anon", "authenticated", "postgres", "service_role";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."expense_category_budgets" TO "anon", "authenticated", "postgres", "service_role";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."expenses" TO "anon", "authenticated", "postgres", "service_role";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."food_monthly_budget" TO "anon", "authenticated", "postgres", "service_role";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."food_offers" TO "anon", "authenticated", "postgres", "service_role";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."food_pantry_items" TO "anon", "authenticated", "postgres", "service_role";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."food_purchases" TO "anon", "authenticated", "postgres", "service_role";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."food_recipes" TO "anon", "authenticated", "postgres", "service_role";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."food_saved_plans" TO "anon", "authenticated", "postgres", "service_role";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."food_selected_stores" TO "anon", "authenticated", "postgres", "service_role";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."food_shopping_items" TO "anon", "authenticated", "postgres", "service_role";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."food_standard_prices" TO "anon", "authenticated", "postgres", "service_role";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."global_offers" TO "anon", "authenticated", "postgres", "service_role";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."global_recipes" TO "anon", "authenticated", "postgres", "service_role";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."global_standard_prices" TO "anon", "authenticated", "postgres", "service_role";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."habits" TO "anon", "authenticated", "postgres", "service_role";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."household_moving_items" TO "anon", "authenticated", "postgres", "service_role";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."household_shopping_items" TO "anon", "authenticated", "postgres", "service_role";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."household_tasks" TO "anon", "authenticated", "postgres", "service_role";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."income" TO "anon", "authenticated", "postgres", "service_role";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."job_applications" TO "anon", "authenticated", "postgres", "service_role";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."life_goals" TO "anon", "authenticated", "postgres", "service_role";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."profiles" TO "anon", "authenticated", "postgres", "service_role";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."savings_extra" TO "anon", "authenticated", "postgres", "service_role";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."savings_goals" TO "anon", "authenticated", "postgres", "service_role";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."savings_history" TO "anon", "authenticated", "postgres", "service_role";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."settings" TO "anon", "authenticated", "postgres", "service_role";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."skills" TO "anon", "authenticated", "postgres", "service_role";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."symptom_logs" TO "anon", "authenticated", "postgres", "service_role";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."todos" TO "anon", "authenticated", "postgres", "service_role";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."trip_expenses" TO "anon", "authenticated", "postgres", "service_role";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."trip_packing_items" TO "anon", "authenticated", "postgres", "service_role";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."trip_participants" TO "anon", "authenticated", "postgres", "service_role";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."trips" TO "anon", "authenticated", "postgres", "service_role";
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."warranties" TO "anon", "authenticated", "postgres", "service_role";
