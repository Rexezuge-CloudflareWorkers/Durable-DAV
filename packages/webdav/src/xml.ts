import { DOMParser, XMLSerializer, type Document as XmlDocument, type Element as XmlElement, type Node as XmlNode } from '@xmldom/xmldom';
import { escapeXml } from './path';

const DAV_NAMESPACE = 'DAV:';
const RAW_XML_DAV_PROPERTIES = new Set(['resourcetype', 'supportedlock', 'lockdiscovery']);

type DeadProperty = {
  namespaceURI: string;
  localName: string;
  prefix: string | null;
  valueXml: string;
};

type PropfindRequest = { mode: 'allprop' } | { mode: 'propname' } | { mode: 'prop'; properties: DeadProperty[] };

type ProppatchOperation = {
  action: 'set' | 'remove';
  property: DeadProperty;
};

function serializeNodeChildren(node: XmlNode): string {
  const serializer = new XMLSerializer();
  let xml = '';
  for (let child = node.firstChild; child !== null; child = child.nextSibling) {
    xml += serializer.serializeToString(child);
  }
  return xml;
}

function renderDavProperty(propName: string, value: string): string {
  const content = RAW_XML_DAV_PROPERTIES.has(propName) ? value : escapeXml(value);
  return `<${propName}>${content}</${propName}>`;
}

function renderPropertyElement(property: DeadProperty): string {
  const qualifiedName = property.prefix ? `${property.prefix}:${property.localName}` : property.localName;
  const namespaceDeclaration =
    property.namespaceURI === ''
      ? ' xmlns=""'
      : property.prefix
        ? ` xmlns:${property.prefix}="${escapeXml(property.namespaceURI)}"`
        : ` xmlns="${escapeXml(property.namespaceURI)}"`;
  return `<${qualifiedName}${namespaceDeclaration}>${property.valueXml}</${qualifiedName}>`;
}

function renderEmptyPropertyElement(property: DeadProperty): string {
  const qualifiedName = property.prefix ? `${property.prefix}:${property.localName}` : property.localName;
  const namespaceDeclaration =
    property.namespaceURI === ''
      ? ' xmlns=""'
      : property.prefix
        ? ` xmlns:${property.prefix}="${escapeXml(property.namespaceURI)}"`
        : ` xmlns="${escapeXml(property.namespaceURI)}"`;
  return `<${qualifiedName}${namespaceDeclaration} />`;
}

function renderPropstat(status: string, properties: string[]): string {
  return properties.length === 0 ? '' : `\n<propstat>\n<prop>\n${properties.join('\n')}\n</prop>\n<status>${status}</status>\n</propstat>`;
}

function getElementProperty(element: XmlElement): DeadProperty | null {
  if (element.prefix && (element.namespaceURI === null || element.namespaceURI === '')) return null;
  if (element.localName === null) return null;
  return {
    namespaceURI: element.namespaceURI ?? '',
    localName: element.localName,
    prefix: element.prefix,
    valueXml: serializeNodeChildren(element),
  };
}

function parseXmlDocument(body: string): XmlDocument | null {
  const errors: string[] = [];
  try {
    const document = new DOMParser({
      onError: (level, message) => {
        if (level === 'error' || level === 'fatalError') {
          errors.push(message);
        }
      },
    }).parseFromString(body, 'application/xml');
    return errors.length > 0 ? null : document;
  } catch {
    return null;
  }
}

function getChildElements(element: XmlElement): XmlElement[] {
  const children: XmlElement[] = [];
  for (let child = element.firstChild; child !== null; child = child.nextSibling) {
    if (child.nodeType === 1) children.push(child as XmlElement);
  }
  return children;
}

function parsePropfindRequest(body: string): PropfindRequest | null {
  if (body.trim() === '') return { mode: 'allprop' };
  const document = parseXmlDocument(body);
  const root = document?.documentElement;
  if (root === null || root === undefined || (root.localName ?? '').toLowerCase() !== 'propfind') return null;
  const propfindChildren = getChildElements(root);
  if (propfindChildren.some((child) => (child.localName ?? '').toLowerCase() === 'propname')) return { mode: 'propname' };
  const propElement = propfindChildren.find((child) => (child.localName ?? '').toLowerCase() === 'prop');
  if (propElement !== undefined) {
    const properties = getChildElements(propElement).map(getElementProperty);
    return properties.includes(null) ? null : { mode: 'prop', properties: properties as DeadProperty[] };
  }
  return propfindChildren.some((child) => (child.localName ?? '').toLowerCase() === 'allprop') ? { mode: 'allprop' } : null;
}

function parseProppatchRequest(body: string): { operations: ProppatchOperation[] } | null {
  const document = parseXmlDocument(body);
  const root = document?.documentElement;
  if (root === null || root === undefined || (root.localName ?? '').toLowerCase() !== 'propertyupdate') return null;
  const operations: ProppatchOperation[] = [];
  for (const actionElement of getChildElements(root)) {
    const action = (actionElement.localName ?? '').toLowerCase();
    if (action !== 'set' && action !== 'remove') continue;
    const propElement = getChildElements(actionElement).find((child) => (child.localName ?? '').toLowerCase() === 'prop');
    if (propElement === undefined) continue;
    for (const propertyElement of getChildElements(propElement)) {
      const property = getElementProperty(propertyElement);
      if (property === null) return null;
      operations.push({ action, property });
    }
  }
  return { operations };
}

function isValidXmlTagName(propName: string): boolean {
  return /^[A-Z_][\w.:-]*$/i.test(propName);
}

function extractLockOwner(body: string): string | undefined {
  const owner = /<owner(?:\s[^>]*)?>([\s\S]*?)<\/owner>/i.exec(body)?.[1];
  if (owner === undefined) return undefined;
  const trimmed = owner.trim();
  return trimmed === '' ? undefined : trimmed;
}

export {
  DAV_NAMESPACE,
  parseXmlDocument,
  getChildElements,
  getElementProperty,
  serializeNodeChildren,
  renderDavProperty,
  renderPropertyElement,
  renderEmptyPropertyElement,
  renderPropstat,
  parsePropfindRequest,
  parseProppatchRequest,
  isValidXmlTagName,
  extractLockOwner,
};
export type { DeadProperty, PropfindRequest, ProppatchOperation };
