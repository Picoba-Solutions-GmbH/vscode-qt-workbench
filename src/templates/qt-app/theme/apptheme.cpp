#include "apptheme.h"

#include <QGuiApplication>
#include <QStyleHints>

AppTheme::AppTheme(QObject *parent)
    : QObject(parent)
    , m_lightMode(QGuiApplication::styleHints()->colorScheme() != Qt::ColorScheme::Dark)
{
}

bool AppTheme::lightMode() const
{
    return m_lightMode;
}

void AppTheme::setLightMode(bool lightMode)
{
    if (m_lightMode == lightMode)
        return;

    m_lightMode = lightMode;
    emit themeChanged();
}

void AppTheme::toggle()
{
    setLightMode(!m_lightMode);
}

QColor AppTheme::background() const
{
    return m_lightMode ? QColor("#e7e7e7") : QColor("#1f1f1f");
}

QColor AppTheme::surface() const
{
    return m_lightMode ? QColor("#f7f7f7") : QColor("#2b2b2b");
}

QColor AppTheme::text() const
{
    return m_lightMode ? QColor("#1f1f1f") : QColor("#e7e7e7");
}

QColor AppTheme::subtleText() const
{
    return m_lightMode ? QColor("#6b6b6b") : QColor("#9a9a9a");
}

QColor AppTheme::accent() const
{
    return m_lightMode ? QColor("#2d6cdf") : QColor("#5b9cff");
}

QColor AppTheme::textOnAccent() const
{
    return QColor("#ffffff");
}

QColor AppTheme::border() const
{
    return m_lightMode ? QColor("#c9c9c9") : QColor("#3d3d3d");
}

QColor AppTheme::priorityColor(int priority) const
{
    switch (priority) {
    case 2:
        return m_lightMode ? QColor("#c0392b") : QColor("#ff6b5b");
    case 0:
        return m_lightMode ? QColor("#6b6b6b") : QColor("#9a9a9a");
    default:
        return m_lightMode ? QColor("#b8860b") : QColor("#e0b341");
    }
}
