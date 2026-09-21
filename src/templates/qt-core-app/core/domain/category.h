#ifndef CATEGORY_H
#define CATEGORY_H

#include <QList>
#include <QObject>
#include <QString>

#include <optional>

// What an expense was for.
//
// Q_NAMESPACE and Q_ENUM_NS give the enum's names at run time, with Qt Core
// alone: the ledger file stores a category by its name. The app makes the enum
// a QML type too (app/viewmodels/coretypes.h), so QML can say Category.Food --
// without this library knowing that QML exists.
namespace Category {
Q_NAMESPACE

enum Kind {
    Food,
    Housing,
    Transport,
    Leisure,
    Other
};
Q_ENUM_NS(Kind)

// Every category, in the enum's order.
QList<Kind> all();

// The name a file stores a category by: "Food" for Food. Never translated.
QString key(Kind kind);
// The category a stored name stands for, if any.
std::optional<Kind> fromKey(const QString &key);

} // namespace Category

#endif // CATEGORY_H
