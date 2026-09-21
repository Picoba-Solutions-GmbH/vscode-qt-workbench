#include "jsonplayground.h"

#include "jsonvariant.h"

#include <nlohmann/json.hpp>

#include <string>
#include <vector>

namespace {

struct OrderLine
{
    std::string article;
    int quantity = 0;
    double price = 0.0;
};

struct Order
{
    int id = 0;
    std::string customer;
    bool paid = false;
    std::vector<OrderLine> lines;
};

// These macros write to_json() and from_json() for a struct: each member becomes
// a key of the same name. from_json() throws when a key is missing or has the
// wrong type; the _WITH_DEFAULT variant would keep the member's default instead.
NLOHMANN_DEFINE_TYPE_NON_INTRUSIVE(OrderLine, article, quantity, price)
NLOHMANN_DEFINE_TYPE_NON_INTRUSIVE(Order, id, customer, paid, lines)

} // namespace

JsonPlayground::JsonPlayground(QObject *parent)
    : QObject(parent)
{
}

QString JsonPlayground::error() const
{
    return m_error;
}

void JsonPlayground::setError(const QString &error)
{
    if (m_error == error)
        return;

    m_error = error;
    emit errorChanged();
}

QString JsonPlayground::sampleOrder() const
{
    const Order order{1042, "Ada Lovelace", false, {{"Keyboard", 1, 49.90}, {"USB cable", 3, 4.50}}};

    // Assigning a struct to a json uses the to_json() written by the macro above.
    const nlohmann::json json = order;
    return QString::fromStdString(json.dump(2));
}

QString JsonPlayground::format(const QString &text, int indent)
{
    // parse() throws nlohmann::json::parse_error for text that is no JSON. Its
    // what() says where: "parse error at line 3, column 5: ...".
    try {
        const nlohmann::json json = nlohmann::json::parse(text.toStdString());
        setError({});
        return QString::fromStdString(json.dump(indent));
    } catch (const nlohmann::json::exception &e) {
        setError(QString::fromUtf8(e.what()));
        return {};
    }
}

QString JsonPlayground::describeOrder(const QString &text)
{
    try {
        // get<Order>() uses the from_json() written by the macro above.
        const Order order = nlohmann::json::parse(text.toStdString()).get<Order>();
        setError({});

        QString description = QStringLiteral("Order %1 for %2, %3\n")
                                  .arg(order.id)
                                  .arg(QString::fromStdString(order.customer),
                                       order.paid ? QStringLiteral("paid") : QStringLiteral("not paid"));
        double total = 0.0;
        for (const OrderLine &line : order.lines) {
            description += QStringLiteral("  %1 x %2 at %3\n")
                               .arg(line.quantity)
                               .arg(QString::fromStdString(line.article))
                               .arg(line.price, 0, 'f', 2);
            total += line.quantity * line.price;
        }
        return description + QStringLiteral("Total: %1").arg(total, 0, 'f', 2);
    } catch (const nlohmann::json::exception &e) {
        // A type_error or out_of_range here means the JSON is valid but does
        // not have the shape of an Order.
        setError(QString::fromUtf8(e.what()));
        return {};
    }
}

QVariant JsonPlayground::toVariant(const QString &text)
{
    try {
        const QVariant value = jsonToVariant(nlohmann::json::parse(text.toStdString()));
        setError({});
        return value;
    } catch (const nlohmann::json::exception &e) {
        setError(QString::fromUtf8(e.what()));
        return {};
    }
}
