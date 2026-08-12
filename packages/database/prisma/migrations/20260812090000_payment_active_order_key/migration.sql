-- One nullable key protects the single active checkout invariant while keeping
-- every historical order. Existing rows remain unchanged and are claimed by
-- the application the next time they are reused.
ALTER TABLE `PaymentOrder`
  ADD COLUMN `activeKey` VARCHAR(128) NULL,
  ADD UNIQUE INDEX `PaymentOrder_activeKey_key`(`activeKey`);
