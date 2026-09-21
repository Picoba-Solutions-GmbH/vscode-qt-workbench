#include "jsonvariant.h"

#include <QString>
#include <QVariantList>
#include <QVariantMap>

QVariant jsonToVariant(const nlohmann::json &value)
{
    // type() tells what a json value holds; get<T>() takes it out.
    switch (value.type()) {
    case nlohmann::json::value_t::object: {
        QVariantMap map;
        for (const auto &[key, item] : value.items())
            map.insert(QString::fromStdString(key), jsonToVariant(item));
        return map;
    }
    case nlohmann::json::value_t::array: {
        QVariantList list;
        for (const auto &item : value)
            list.append(jsonToVariant(item));
        return list;
    }
    case nlohmann::json::value_t::string:
        // nlohmann::json keeps strings as UTF-8 std::string.
        return QString::fromStdString(value.get<std::string>());
    case nlohmann::json::value_t::boolean:
        return value.get<bool>();
    case nlohmann::json::value_t::number_integer:
        return QVariant::fromValue(value.get<qint64>());
    case nlohmann::json::value_t::number_unsigned:
        return QVariant::fromValue(value.get<quint64>());
    case nlohmann::json::value_t::number_float:
        return value.get<double>();
    default:
        // null and discarded values: an invalid QVariant arrives in QML as undefined.
        return {};
    }
}
