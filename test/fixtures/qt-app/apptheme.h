#ifndef APPTHEME_H
#define APPTHEME_H

#include <QColor>
#include <QObject>
#include <QtQmlIntegration>

// QML_SINGLETON: the QML engine creates exactly one of these, lazily, the first
// time QML touches it. In QML you just write "AppTheme.background" -- there is
// no "AppTheme { }" declaration anywhere. Closest C# analogue: a DI-registered
// singleton service, except the engine owns the lifetime.
//
// Note that every Q_PROPERTY below shares ONE notify signal (themeChanged).
// That is legal and common in Qt: flipping lightMode invalidates all the
// colours at once, so one signal is enough to refresh every binding.
class AppTheme : public QObject
{
    Q_OBJECT
    QML_ELEMENT
    QML_SINGLETON

    Q_PROPERTY(bool lightMode READ lightMode WRITE setLightMode NOTIFY themeChanged)
    Q_PROPERTY(QColor background READ background NOTIFY themeChanged)
    Q_PROPERTY(QColor surface READ surface NOTIFY themeChanged)
    Q_PROPERTY(QColor text READ text NOTIFY themeChanged)
    Q_PROPERTY(QColor subtleText READ subtleText NOTIFY themeChanged)
    Q_PROPERTY(QColor accent READ accent NOTIFY themeChanged)
    Q_PROPERTY(QColor textOnAccent READ textOnAccent NOTIFY themeChanged)
    Q_PROPERTY(QColor border READ border NOTIFY themeChanged)

public:
    explicit AppTheme(QObject *parent = nullptr);

    bool lightMode() const;
    void setLightMode(bool lightMode);

    QColor background() const;
    QColor surface() const;
    QColor text() const;
    QColor subtleText() const;
    QColor accent() const;
    QColor textOnAccent() const;
    QColor border() const;

    Q_INVOKABLE void toggle();

    // Priority 0/1/2 -> a colour. Called from QML delegates.
    Q_INVOKABLE QColor priorityColor(int priority) const;

signals:
    void themeChanged();

private:
    bool m_lightMode = true;
};

#endif // APPTHEME_H
