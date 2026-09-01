DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'derya_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON
      "LeadGenRun", "LeadDiscovery", "OutreachCampaign", "OutreachCampaignSend"
      TO derya_app;
  END IF;
END
$$;
