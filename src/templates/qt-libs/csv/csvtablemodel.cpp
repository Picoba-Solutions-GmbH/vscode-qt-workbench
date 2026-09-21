#include "csvtablemodel.h"

#include <QFile>

#include <csv.hpp>

#include <exception>
#include <string>
#include <vector>

CsvTableModel::CsvTableModel(QObject *parent)
    : QAbstractTableModel(parent)
{
}

int CsvTableModel::rowCount(const QModelIndex &parent) const
{
    return parent.isValid() ? 0 : static_cast<int>(m_rows.size());
}

int CsvTableModel::columnCount(const QModelIndex &parent) const
{
    return parent.isValid() ? 0 : static_cast<int>(m_columns.size());
}

QVariant CsvTableModel::data(const QModelIndex &index, int role) const
{
    if (!index.isValid() || role != Qt::DisplayRole)
        return {};

    const QStringList &row = m_rows.at(index.row());
    return index.column() < row.size() ? row.at(index.column()) : QString();
}

QVariant CsvTableModel::headerData(int section, Qt::Orientation orientation, int role) const
{
    if (role != Qt::DisplayRole)
        return {};
    if (orientation == Qt::Vertical)
        return section + 1;
    return section < m_columns.size() ? m_columns.at(section) : QVariant();
}

QStringList CsvTableModel::columnNames() const
{
    return m_columns;
}

int CsvTableModel::rows() const
{
    return static_cast<int>(m_rows.size());
}

QString CsvTableModel::summary() const
{
    return m_summary;
}

QString CsvTableModel::error() const
{
    return m_error;
}

void CsvTableModel::fail(const QString &error)
{
    beginResetModel();
    m_columns.clear();
    m_rows.clear();
    m_summary.clear();
    m_error = error;
    endResetModel();
    emit loaded();
}

void CsvTableModel::loadText(const QString &text)
{
    QStringList columns;
    QList<QStringList> rows;
    struct Numbers { int count = 0; double sum = 0.0; bool onlyNumbers = true; };
    std::vector<Numbers> numbers;

    try {
        // csv::parse() reads from a string; csv::CSVReader reads a file by name.
        // guess_csv() works out the delimiter and which line holds the names.
        const std::string utf8 = text.toStdString();
        csv::CSVReader reader = csv::parse(utf8, csv::CSVFormat::guess_csv());

        for (const std::string &name : reader.get_col_names())
            columns.append(QString::fromStdString(name));
        numbers.resize(columns.size());

        // Rows are read as the loop asks for them, so even a file larger than
        // memory can be walked through this way.
        for (csv::CSVRow &row : reader) {
            QStringList cells;
            for (size_t i = 0; i < row.size(); ++i) {
                csv::CSVField field = row[i];
                cells.append(QString::fromStdString(field.get<std::string>()));

                // The parser tells numbers from text without converting twice:
                // is_num() is true for integers and decimals alike.
                if (i >= numbers.size() || field.is_null())
                    continue;
                if (field.is_num()) {
                    numbers[i].sum += field.get<double>();
                    ++numbers[i].count;
                } else {
                    numbers[i].onlyNumbers = false;
                }
            }
            rows.append(cells);
        }
    } catch (const std::exception &e) {
        fail(QString::fromUtf8(e.what()));
        return;
    }

    QStringList summary;
    for (size_t i = 0; i < numbers.size(); ++i) {
        const Numbers &column = numbers[i];
        if (!column.onlyNumbers || column.count == 0)
            continue;
        summary.append(tr("%1: sum %2, mean %3")
                           .arg(columns.at(i))
                           .arg(column.sum, 0, 'g', 10)
                           .arg(column.sum / column.count, 0, 'f', 2));
    }

    // A model that changes completely announces it with a reset.
    beginResetModel();
    m_columns = columns;
    m_rows = rows;
    m_summary = summary.join(QStringLiteral("\n"));
    m_error.clear();
    endResetModel();
    emit loaded();
}

void CsvTableModel::loadFile(const QUrl &file)
{
    // Reading through QFile handles every path Qt does, non-ASCII names on
    // Windows included.
    QFile in(file.toLocalFile());
    if (!in.open(QIODevice::ReadOnly | QIODevice::Text)) {
        fail(in.errorString());
        return;
    }
    loadText(QString::fromUtf8(in.readAll()));
}
