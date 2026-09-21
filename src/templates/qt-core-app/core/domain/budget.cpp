#include "budget.h"

Budget::Status Budget::status(qint64 spentCents, qint64 limitCents)
{
    if (limitCents <= 0)
        return NoLimit;
    if (spentCents > limitCents)
        return OverBudget;
    // Whole numbers throughout: spent / limit >= 80 / 100, without dividing.
    if (spentCents * 100 >= limitCents * NearLimitPercent)
        return NearLimit;
    return WithinBudget;
}
