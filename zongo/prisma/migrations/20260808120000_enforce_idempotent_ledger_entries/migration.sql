DELETE FROM "LedgerEntry"
WHERE "id" IN (
  SELECT "id"
  FROM (
    SELECT
      "id",
      ROW_NUMBER() OVER (
        PARTITION BY "transactionId", "eventName", "account", "direction"
        ORDER BY "createdAt", "id"
      ) AS "duplicateNumber"
    FROM "LedgerEntry"
  ) AS "rankedEntries"
  WHERE "duplicateNumber" > 1
);

CREATE UNIQUE INDEX "LedgerEntry_transactionId_eventName_account_direction_key"
ON "LedgerEntry"("transactionId", "eventName", "account", "direction");
