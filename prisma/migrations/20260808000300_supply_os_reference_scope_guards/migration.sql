-- Reject office-owned references that point at records in another office.
CREATE FUNCTION supply_assert_office_reference()
RETURNS TRIGGER AS $$
DECLARE
    reference_id TEXT;
    reference_matches BOOLEAN;
BEGIN
    reference_id := to_jsonb(NEW) ->> TG_ARGV[1];
    IF reference_id IS NULL THEN
        RETURN NEW;
    END IF;

    EXECUTE format(
        'SELECT EXISTS (SELECT 1 FROM %I WHERE "id" = $1 AND "officeId" = $2)',
        TG_ARGV[0]
    ) INTO reference_matches USING reference_id, NEW."officeId";

    IF NOT reference_matches THEN
        RAISE EXCEPTION '% reference % is outside the Supply OS office scope', TG_TABLE_NAME, TG_ARGV[1];
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "SupplyWorkspace_company_office_guard"
BEFORE INSERT OR UPDATE ON "SupplyWorkspace"
FOR EACH ROW EXECUTE FUNCTION supply_assert_office_reference('Company', 'companyId');
CREATE TRIGGER "SupplyWorkspace_user_office_guard"
BEFORE INSERT OR UPDATE ON "SupplyWorkspace"
FOR EACH ROW EXECUTE FUNCTION supply_assert_office_reference('User', 'createdByUserId');
CREATE TRIGGER "SupplyWorkspaceMember_user_office_guard"
BEFORE INSERT OR UPDATE ON "SupplyWorkspaceMember"
FOR EACH ROW EXECUTE FUNCTION supply_assert_office_reference('User', 'userId');
CREATE TRIGGER "SupplyImportRun_user_office_guard"
BEFORE INSERT OR UPDATE ON "SupplyImportRun"
FOR EACH ROW EXECUTE FUNCTION supply_assert_office_reference('User', 'createdByUserId');
CREATE TRIGGER "SupplySnapshot_user_office_guard"
BEFORE INSERT OR UPDATE ON "SupplySnapshot"
FOR EACH ROW EXECUTE FUNCTION supply_assert_office_reference('User', 'createdByUserId');
CREATE TRIGGER "SupplyItemAlias_user_office_guard"
BEFORE INSERT OR UPDATE ON "SupplyItemAlias"
FOR EACH ROW EXECUTE FUNCTION supply_assert_office_reference('User', 'approvedByUserId');

-- Snapshot-owned references must point at rows in the exact same snapshot.
CREATE FUNCTION supply_assert_same_snapshot_reference()
RETURNS TRIGGER AS $$
DECLARE
    reference_id TEXT;
    reference_matches BOOLEAN;
BEGIN
    reference_id := to_jsonb(NEW) ->> TG_ARGV[1];
    IF reference_id IS NULL THEN
        RETURN NEW;
    END IF;
    IF NEW."snapshotId" IS NULL THEN
        RAISE EXCEPTION '% reference % requires a Supply OS snapshot', TG_TABLE_NAME, TG_ARGV[1];
    END IF;

    EXECUTE format(
        'SELECT EXISTS (
            SELECT 1 FROM %I
            WHERE "id" = $1
              AND "officeId" = $2
              AND "workspaceId" = $3
              AND "snapshotId" = $4
        )',
        TG_ARGV[0]
    ) INTO reference_matches
      USING reference_id, NEW."officeId", NEW."workspaceId", NEW."snapshotId";

    IF NOT reference_matches THEN
        RAISE EXCEPTION '% reference % is outside the Supply OS snapshot scope', TG_TABLE_NAME, TG_ARGV[1];
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "SupplyBomVersion_product_snapshot_guard"
BEFORE INSERT OR UPDATE ON "SupplyBomVersion"
FOR EACH ROW EXECUTE FUNCTION supply_assert_same_snapshot_reference('SupplyItem', 'productItemId');

CREATE TRIGGER "SupplyBomLine_version_snapshot_guard"
BEFORE INSERT OR UPDATE ON "SupplyBomLine"
FOR EACH ROW EXECUTE FUNCTION supply_assert_same_snapshot_reference('SupplyBomVersion', 'bomVersionId');
CREATE TRIGGER "SupplyBomLine_parent_snapshot_guard"
BEFORE INSERT OR UPDATE ON "SupplyBomLine"
FOR EACH ROW EXECUTE FUNCTION supply_assert_same_snapshot_reference('SupplyItem', 'parentItemId');
CREATE TRIGGER "SupplyBomLine_component_snapshot_guard"
BEFORE INSERT OR UPDATE ON "SupplyBomLine"
FOR EACH ROW EXECUTE FUNCTION supply_assert_same_snapshot_reference('SupplyItem', 'componentItemId');

CREATE TRIGGER "SupplyInventoryPosition_item_snapshot_guard"
BEFORE INSERT OR UPDATE ON "SupplyInventoryPosition"
FOR EACH ROW EXECUTE FUNCTION supply_assert_same_snapshot_reference('SupplyItem', 'itemId');
CREATE TRIGGER "SupplyInventoryPosition_location_snapshot_guard"
BEFORE INSERT OR UPDATE ON "SupplyInventoryPosition"
FOR EACH ROW EXECUTE FUNCTION supply_assert_same_snapshot_reference('SupplyLocation', 'locationId');

CREATE TRIGGER "SupplyDemand_item_snapshot_guard"
BEFORE INSERT OR UPDATE ON "SupplyDemand"
FOR EACH ROW EXECUTE FUNCTION supply_assert_same_snapshot_reference('SupplyItem', 'itemId');
CREATE TRIGGER "SupplyDemand_location_snapshot_guard"
BEFORE INSERT OR UPDATE ON "SupplyDemand"
FOR EACH ROW EXECUTE FUNCTION supply_assert_same_snapshot_reference('SupplyLocation', 'locationId');

CREATE TRIGGER "SupplyMediaAsset_item_snapshot_guard"
BEFORE INSERT OR UPDATE ON "SupplyMediaAsset"
FOR EACH ROW EXECUTE FUNCTION supply_assert_same_snapshot_reference('SupplyItem', 'itemId');
CREATE TRIGGER "SupplyMediaAsset_location_snapshot_guard"
BEFORE INSERT OR UPDATE ON "SupplyMediaAsset"
FOR EACH ROW EXECUTE FUNCTION supply_assert_same_snapshot_reference('SupplyLocation', 'locationId');
