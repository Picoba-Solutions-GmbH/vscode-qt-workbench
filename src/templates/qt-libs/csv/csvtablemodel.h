#ifndef CSVTABLEMODEL_H
#define CSVTABLEMODEL_H

#include <QAbstractTableModel>
#include <QList>
#include <QStringList>
#include <QUrl>
#include <QtQmlIntegration>

// CSV with vincentlaucsb's csv-parser, shown in a QML TableView.
//
// QAbstractTableModel is the contract a TableView binds to: rowCount(),
// columnCount() and data() for the cells, headerData() for the column names a
// HorizontalHeaderView shows.
class CsvTableModel : public QAbstractTableModel
{
    Q_OBJECT
    QML_ELEMENT

    Q_PROPERTY(QStringList columnNames READ columnNames NOTIFY loaded)
    Q_PROPERTY(int rows READ rows NOTIFY loaded)
    // Sum and mean of every column that holds only numbers.
    Q_PROPERTY(QString summary READ summary NOTIFY loaded)
    Q_PROPERTY(QString error READ error NOTIFY loaded)

public:
    explicit CsvTableModel(QObject *parent = nullptr);

    int rowCount(const QModelIndex &parent = QModelIndex()) const override;
    int columnCount(const QModelIndex &parent = QModelIndex()) const override;
    QVariant data(const QModelIndex &index, int role = Qt::DisplayRole) const override;
    QVariant headerData(int section, Qt::Orientation orientation, int role = Qt::DisplayRole) const override;

    QStringList columnNames() const;
    int rows() const;
    QString summary() const;
    QString error() const;

    // Parses CSV text. The first line holds the column names; the delimiter
    // (comma, semicolon, tab...) is guessed.
    Q_INVOKABLE void loadText(const QString &text);
    // Parses a CSV file, as a FileDialog hands it over.
    Q_INVOKABLE void loadFile(const QUrl &file);

signals:
    void loaded();

private:
    void fail(const QString &error);

    QStringList m_columns;
    QList<QStringList> m_rows;
    QString m_summary;
    QString m_error;
};

#endif // CSVTABLEMODEL_H
