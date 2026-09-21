#include "category.h"

#include <QMetaEnum>

QList<Category::Kind> Category::all()
{
    // Read from the enum itself, so a category added to it needs nothing here.
    const QMetaEnum meta = QMetaEnum::fromType<Kind>();
    QList<Kind> kinds;
    for (int i = 0; i < meta.keyCount(); ++i)
        kinds.append(static_cast<Kind>(meta.value(i)));
    return kinds;
}

QString Category::key(Kind kind)
{
    return QString::fromLatin1(QMetaEnum::fromType<Kind>().valueToKey(kind));
}

std::optional<Category::Kind> Category::fromKey(const QString &key)
{
    bool ok = false;
    const int value = QMetaEnum::fromType<Kind>().keyToValue(key.toLatin1().constData(), &ok);
    if (!ok)
        return std::nullopt;
    return static_cast<Kind>(value);
}
