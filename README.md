# mail2pdf

This is a small and simple pdf client which converts e-mails to pdf files. This tool connects to one or more imap mail boxes and exports each email into one, single pdf file. Attachments will be converted to pdf, too. After creating the pdf files, the mail body and the attachment will be merged into one single pdf file.  

An exported email contains the following pages:
1. One page which contains meta informations about the email like sender, receiver, date and subject
1. The next page is the mail body
1. All other pages are attachments which were also converted to pdf. Currently the following file types for attachments are supported
    * pdf
    * jpg, jpeg, png, bmp
    * doc, docx, csv, xls, xlsx
    * all other text files which are recognized as text like txt

## Requirements
* Node.js (I tested only v16)
* libreoffice (for converting office documents)

## Installation
1. See requirements
1. Clone this repository and run `npm install`

## Usage
To get started, you need to configure the imap inboxes within the configuration file `mailer.conf.json`.
1. Add a mailbox config / replace the sample mailbox config with your credentials. The config object is pretty self-explained and will be directly passed to [imap](https://www.npmjs.com/package/imap).
1. You can change the output folder to whatever you like. This is where this tool outputs the pdf files per mail. I'm using this tool with [paperless-ngx](https://github.com/paperless-ngx/paperless-ngx) and output my mail pdf files into the paperless consumer folder.
1. Create a cronjob if you like to run this periodically:
    ```sh
    */5 * * * * node src/mailer.js
    ```

### Special configuration keys
`outputFolder`  
Folder where the tool outputs the pdf files

`mailboxes[n].deleteAfterProcess`  
Whether processed mails should be deleted from your inbox. If set to false, mails will just marked as seen.

`mailboxes[n].inboxPath`  
Mailbox folder which should be polled. This config key gets directly passed to [openInbox](https://www.npmjs.com/package/imap).

`mailboxes[n].searchQuery`  
Search query inside the inbox path. This config key gets directly passed to [imap.search](https://www.npmjs.com/package/imap). Examples: `[UNSEEN]`, `[1:10]` for the first 10 emails.
