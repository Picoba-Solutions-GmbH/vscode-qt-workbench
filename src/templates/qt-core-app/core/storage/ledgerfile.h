#ifndef LEDGERFILE_H
#define LEDGERFILE_H

#include <QString>

class Ledger;

// A ledger in a JSON file:
//
//   {
//       "expenses": [
//           { "id": 1, "date": "2026-09-18", "description": "Groceries",
//             "category": "Food", "amountCents": 4230 }
//       ],
//       "limits": { "Food": 40000 }
//   }
//
// Which file, and when to write it, is the application's choice (main.cpp).
namespace LedgerFile {

// Replaces what the ledger holds with what the file holds. Returns what is
// wrong with the file instead, leaving the ledger as it was.
QString read(const QString &path, Ledger &ledger);

// Writes the ledger, creating the file's folder when needed. Returns what went
// wrong, or an empty string. The file is replaced only once all of it is
// written, so a failure never leaves half a file.
QString write(const QString &path, const Ledger &ledger);

} // namespace LedgerFile

#endif // LEDGERFILE_H
