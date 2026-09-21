#ifndef JSONVARIANT_H
#define JSONVARIANT_H

#include <QVariant>

#include <nlohmann/json.hpp>

// A JSON value as QML sees it: an object becomes a QVariantMap and an array a
// QVariantList, which QML receives as a plain JavaScript object and array.
QVariant jsonToVariant(const nlohmann::json &value);

#endif // JSONVARIANT_H
