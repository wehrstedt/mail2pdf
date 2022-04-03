const Imap = require('imap');
const inspect = require('util').inspect;
const fs = require('fs');
const path = require("path");
const crypto = require('crypto');
const simpleParser = require('mailparser').simpleParser;
const html2pdf = require('html-pdf-node');
const PDFMerger = require('pdf-merger-js');
const PDFDocument = require('pdfkit');
const OUT_FOLDER = "mails-to-process";
const PROCESSED_OUT_FOLDER = "processed-mails";
const { isText } = require('istextorbinary');
const libre = require('libreoffice-convert');
libre.convertAsync = require('util').promisify(libre.convert);
const promises = [];
const uids = [];
let processResolve = null;

function handleError(err) {
	try {
		console.error(err);
		imap.end();
	} finally {
		process.exit(1);
	}
}

function saveMail(mailId, mail) {
	const mailFolder = path.join(OUT_FOLDER, mailId);
	if (fs.existsSync(mailFolder)) {
		fs.rmSync(mailFolder, { recursive: true })
	}

	fs.mkdirSync(mailFolder, { recursive: true });

	const mailBody = mail.html || mail.textAsHtml || mail.text;
	const body = mailBody.replace(/(<meta .+)charset=.+"(.+)/, "$1charset=utf-8\"$2");
	const filePath = path.join(mailFolder, mailId + ".html");
	fs.writeFileSync(filePath, body);

	// Save mail meta data
	const metaDataFilePath = path.join(mailFolder, mailId + "_meta.txt");
	fs.writeFileSync(metaDataFilePath, [
		"Betreff: " + mail.subject,
		"Empfangen am: " + mail.date.toLocaleDateString('de-DE', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
		"Von: " + mail.from.text,
		"Empfänger: " + mail.to.text,
	].join("\n"));

	// Save attachments
	for (const attachment of mail.attachments || []) {
		const attachmentPath = path.join(mailFolder, attachment.filename);
		fs.writeFileSync(attachmentPath, attachment.content)
	}
}

function convertHtml2Pdf(filePath) {
	return new Promise((resolve, reject) => {
		try {
			const file = {
				content: fs.readFileSync(filePath, { encoding: "utf-8" })
			};

			html2pdf.generatePdf(file, { format: 'A4' }).then(pdfBuffer => {
				try {
					const parsedPath = path.parse(filePath);
					const pdfFilePath = path.join(parsedPath.dir, parsedPath.name + ".pdf");
					fs.writeFileSync(pdfFilePath, pdfBuffer);
					resolve(pdfFilePath);
				} catch (err) {
					reject(err);
				}
			}).catch(reject);
		} catch (err) {
			reject(err);
		}
	});
}

function convertText2Pdf(filePath) {
	return new Promise((resolve, reject) => {
		const parsedPath = path.parse(filePath);
		const outFilePath = path.join(parsedPath.dir, parsedPath.name + ".pdf");
		const pdfDoc = new PDFDocument();
		const writeStream = fs.createWriteStream(outFilePath);
		writeStream.on("error", reject);
		writeStream.on("finish", () => {
			resolve(outFilePath);
		});

		pdfDoc.pipe(writeStream);
		pdfDoc.text(fs.readFileSync(filePath));
		pdfDoc.end();
	});
}

function convertImage2Pdf(filePath) {
	return new Promise((resolve, reject) => {
		const parsedPath = path.parse(filePath);
		const outFilePath = path.join(parsedPath.dir, parsedPath.name + ".pdf");
		const pdfDoc = new PDFDocument();
		const writeStream = fs.createWriteStream(outFilePath);
		writeStream.on("error", reject);
		writeStream.on("finish", () => {
			resolve(outFilePath);
		});

		pdfDoc.pipe(writeStream);
		pdfDoc.image(filePath, 0, 15, { width: 500 });
		pdfDoc.end();
	});
}

function convertOffice2Pdf(filePath) {
	return new Promise((resolve, reject) => {
		// Read file
		const docxBuf = fs.readFileSync(filePath);

		// Convert it to pdf format with undefined filter (see Libreoffice docs about filter)
		libre.convert(docxBuf, ".pdf", undefined, (err, data) => {
			if (err) {
				reject(err);
			}

			// Here in done you have pdf file which you can save or transfer in another stream
			const parsedPath = path.parse(filePath);
			const outFilePath = path.join(parsedPath.dir, parsedPath.name + ".pdf");
			fs.writeFileSync(outFilePath, data);
			resolve(outFilePath);
		});
	});
}

function getMailId(mail) {
	let subject = mail.subject.replace(/[/\\?%*:|"<>]/g, "-");
	const outFiles = [
		...fs.readdirSync(OUT_FOLDER),
		...fs.readdirSync(PROCESSED_OUT_FOLDER),
	].map(p => path.parse(p).name);

	if (outFiles.indexOf(subject) > -1) {
		subject += "_" + Date.now();
	}

	return subject;
}

async function mergePdfs(bodyPdf, mailMetaPdfFilePath, others) {
	const merger = new PDFMerger();
	merger.add(mailMetaPdfFilePath);
	merger.add(bodyPdf);

	for (let other of others) {
		const parsedPath = path.parse(other);
		if (parsedPath.ext !== ".pdf") {
			if ([".jpg", ".jpeg", ".png", ".bpm"].indexOf(parsedPath.ext) > -1) {
				other = await convertImage2Pdf(other);
			} else if (parsedPath.ext === ".html") {
				other = await convertHtml2Pdf(other);
			} else if ([".doc", ".docx", ".csv", ".xls", ".xlsx"].indexOf(parsedPath.ext)) {
				other = await convertOffice2Pdf(other);
			} else {
				if (isText(null, fs.readFileSync(other))) {
					other = await convertText2Pdf(other);
				}
			}
		}

		if (path.extname(other) === ".pdf") {
			merger.add(other);
		}
	}

	const targetPath = path.join(path.dirname(bodyPdf), path.basename(bodyPdf, ".pdf") + "_merged.pdf");
	await merger.save(targetPath);
	return targetPath
}

async function afterMailsFetched(imap) {
	await Promise.all(promises);

	// Process all saved mails
	const mailIds = fs.readdirSync(OUT_FOLDER);
	for (const mailId of mailIds) {
		console.log("\nProcess mail " + mailId);
		const folderPath = path.join(OUT_FOLDER, mailId);

		// convert mail body html to pdf
		const mailBodyHtmlFilePath = path.join(folderPath, mailId + ".html");
		const mailBodyPdfFilePath = await convertHtml2Pdf(mailBodyHtmlFilePath);

		// convert meta data file to pdf
		const mailMetaTextFilePath = path.join(folderPath, mailId + "_meta.txt");
		const mailMetaPdfFilePath = await convertText2Pdf(mailMetaTextFilePath);

		// all other files = attachments. Merge all files into one pdf
		const attachments = fs.readdirSync(folderPath).filter(
			f => f !== mailId + ".pdf" && f !== mailId + ".html" && f !== mailId + "_meta.pdf" && f !== mailId + "_meta.txt");
		const mergedPdfPath = await mergePdfs(mailBodyPdfFilePath, mailMetaPdfFilePath, attachments.map(a => path.join(folderPath, a)));
		fs.renameSync(mergedPdfPath, path.join(PROCESSED_OUT_FOLDER, path.basename(mergedPdfPath)));

		// remove processed mail
		fs.rmSync(folderPath, { recursive: true });
		console.log("  => Mail " + mailId + " processed.");
	}

	if (uids.length > 0) {
		// Uncomment this if you want to delete the mails after processed
		// imap.setFlags(uids, ['\\Deleted'], function(err) {
		// 	if (err) {
		// 		handleError(err);
		// 	} else {
		// 		imap.end();
		// 		processResolve();
		// 	}
		// });
	}
}

(async () => {
	if (!fs.existsSync(OUT_FOLDER)) {
		fs.mkdirSync(OUT_FOLDER);
	}

	if (!fs.existsSync(PROCESSED_OUT_FOLDER)) {
		fs.mkdirSync(PROCESSED_OUT_FOLDER);
	}

	const configs = fs.readdirSync("conf")
		.filter(c => c !== "sample.json")
		.map(p => path.join("conf", p));

	for (const configPath of configs) {
		await new Promise((resolve, reject) => {
			processResolve = resolve;
			const imap = new Imap(JSON.parse(fs.readFileSync(configPath).toString()));

			imap.once('ready', function() {
				imap.openBox('INBOX/Paperless', false, function(err, box) {
					if (err) {
						handleError(err);
					}

					imap.search(['UNSEEN'], function(err, results) {
						if (results.length > 0) {
							const f = imap.fetch(results, {
								bodies: '',
								markSeen: true
							});

							f.on('message', function(msg, seqno) {
								msg.once('attributes', function(attrs) {
									uids.push(attrs.uid);
								});

								msg.on('body', function(stream, info) {
									promises.push(new Promise((resolve) => {
										simpleParser(stream, (err, mail) => {
											if (err) {
												handleError(err);
											}

											const mailId = getMailId(mail);
											saveMail(mailId, mail);
											resolve();
										});
									}));
								});
							});

							f.once('error', function(err) {
								console.log(err);
							});

							f.once('end', function() {
								console.log('Done fetching all messages!');
								afterMailsFetched(imap);
							});
						} else {
							imap.end();
						}
					});
				});
			});

			imap.once('end', async function() {
				console.log('Connection ended');
			});

			imap.once('error', function(err) {
				handleError(err);
			});

			imap.connect();
		});
	}
})();
