#ifndef CORETYPES_H
#define CORETYPES_H

#include "domain/budget.h"
#include "domain/category.h"

#include <QObject>
#include <QtQmlIntegration>

// The core library's enums as QML types of this module, so QML can say
// Category.Food and Budget.OverBudget.
//
// The core does not link Qt Qml, so it cannot make its types QML types
// itself. QML_FOREIGN_NAMESPACE does it from here, the user interface's side:
// each namespace below registers the core's namespace of the same name, under
// the name QML_NAMED_ELEMENT gives it.
namespace CategoryForeign {
Q_NAMESPACE
QML_FOREIGN_NAMESPACE(Category)
QML_NAMED_ELEMENT(Category)
} // namespace CategoryForeign

namespace BudgetForeign {
Q_NAMESPACE
QML_FOREIGN_NAMESPACE(Budget)
QML_NAMED_ELEMENT(Budget)
} // namespace BudgetForeign

#endif // CORETYPES_H
