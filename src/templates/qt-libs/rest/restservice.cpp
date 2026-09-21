#include "restservice.h"
#include "jsonvariant.h"

#include <QPointer>
#include <QUrl>

#include <curl/curl.h>
#include <nlohmann/json.hpp>

#include <string>
#include <thread>

namespace {
// Callback used by libcurl to capture incoming payload data into std::string
size_t writeCallback(void *contents, size_t size, size_t nmemb, void *userp)
{
    size_t totalSize = size * nmemb;
    static_cast<std::string *>(userp)->append(static_cast<char *>(contents), totalSize);
    return totalSize;
}
} // namespace

RestService::RestService(QObject *parent)
    : QObject(parent)
{
}

RestService::~RestService()
{
    // Requests run on detached worker threads. QPointer prevents callbacks
    // from attempting to access this object after deletion.
}

bool RestService::busy() const
{
    return m_pending > 0;
}

void RestService::setPending(int pending)
{
    const bool wasBusy = busy();
    m_pending = pending;
    if (busy() != wasBusy)
        emit busyChanged();
}

void RestService::get(const QString &urlStr)
{
    setPending(m_pending + 1);

    QPointer<RestService> self(this);
    std::string targetUrl = urlStr.toStdString();

    // Perform libcurl call in a worker thread to keep Qt main thread responsive
    std::thread([self, targetUrl]() {
        CURL *curl = curl_easy_init();
        int status = 0;
        std::string body;
        QString error;

        if (curl) {
            struct curl_slist *headers = nullptr;
            headers = curl_slist_append(headers, "Accept: application/json");

            curl_easy_setopt(curl, CURLOPT_URL, targetUrl.c_str());
            curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);
            curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, writeCallback);
            curl_easy_setopt(curl, CURLOPT_WRITEDATA, &body);
            curl_easy_setopt(curl, CURLOPT_FOLLOWLOCATION, 1L);

            CURLcode res = curl_easy_perform(curl);
            if (res == CURLE_OK) {
                long responseCode = 0;
                curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &responseCode);
                status = static_cast<int>(responseCode);

                if (status >= 400) {
                    error = QString("HTTP Error %1").arg(status);
                }
            } else {
                error = QString("Network Error: %1").arg(curl_easy_strerror(res));
            }

            curl_slist_free_all(headers);
            curl_easy_cleanup(curl);
        } else {
            error = QStringLiteral("Failed to initialize libcurl");
        }

        // Return early if the QObject was deleted while waiting on network
        if (!self)
            return;

        // Parse JSON on worker thread
        QVariant data;
        if (error.isEmpty()) {
            const nlohmann::json json = nlohmann::json::parse(body, nullptr, false);
            if (!json.is_discarded()) {
                data = jsonToVariant(json);
            }
        }

        // Post response back to the object's owner thread
        QMetaObject::invokeMethod(self, [self, status, data, error, bodyStr = QString::fromStdString(body)] {
            if (!self)
                return;

            self->setPending(self->m_pending - 1);
            if (error.isEmpty())
                emit self->replied(status, data, bodyStr);
            else
                emit self->failed(error);
        });
    }).detach();
}